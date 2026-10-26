$ErrorActionPreference='Stop'
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('event-crm-outlook-tests-'+[guid]::NewGuid())
$moduleRoot=Join-Path $testRoot 'Microsoft.Graph.Authentication'
New-Item -ItemType Directory -Path $moduleRoot -Force|Out-Null
@'
function Get-MgContext { @{Account='pa@example.com';Scopes=@('User.Read','Calendars.ReadWrite','Mail.ReadWrite')} }
function Connect-MgGraph {}
function Disconnect-MgGraph {}
function Invoke-MgGraphRequest {
 param($Method,$Uri,$Body,$ContentType,$OutputType)
 $global:graphCalls.Add(@{Method=$Method;Uri=$Uri;Body=$Body})
 if ($Uri -like '*calendarView*') {return @{value=@()}}
 if ($Uri -like '*attendees*') {return @{id='event-1';attendees=@()}}
 return @{id='event-1';webLink='https://outlook.office.com/example'}
}
Export-ModuleMember -Function *
'@|Set-Content (Join-Path $moduleRoot 'Microsoft.Graph.Authentication.psm1')
New-ModuleManifest -Path (Join-Path $moduleRoot 'Microsoft.Graph.Authentication.psd1') -RootModule 'Microsoft.Graph.Authentication.psm1' -ModuleVersion '1.0.0' -FunctionsToExport '*'
$oldModulePath=$env:PSModulePath
$oldToken=$env:CRM_AI_TOKEN
$env:PSModulePath=$testRoot+[IO.Path]::PathSeparator+$env:PSModulePath
$env:CRM_AI_TOKEN='test-token-never-used-on-network'
$global:graphCalls=[Collections.Generic.List[object]]::new()
$global:crmCalls=[Collections.Generic.List[object]]::new()
function global:Invoke-RestMethod {
 param($Method,$Uri,$Headers,$Body,$ContentType)
 $global:crmCalls.Add(@{Method=$Method;Uri=$Uri;Body=$Body})
 if ($Method -eq 'GET') {
  return @{id='b';version=1;reference='B1';event_name='Launch';client_name='Client';venue='London';event_date='2026-11-27';event_start='18:00';event_end='21:00'}
 }
 return @{version=2}
}
function Check($condition,$message) {if (-not $condition) {throw $message}}
$script=Join-Path $PSScriptRoot '../scripts/outlook.ps1'
try {
 $status=& $script -Action Status -Account pa@example.com|ConvertFrom-Json
 Check $status.ready 'Status should recognise matching account'
 $failed=$false
 try {& $script -Action Inbox -Account wrong@example.com|Out-Null} catch {$failed=$true}
 Check $failed 'Wrong mailbox must be rejected'
 & $script -Action Calendar -Account pa@example.com -From '2026-11-27T00:00:00Z' -To '2026-11-28T00:00:00Z'|Out-Null
 Check ($global:graphCalls[-1].Uri -like '*$select=id,subject*') 'Graph select query must remain literal'
 $failed=$false
 try {& $script -Action Calendar -Account pa@example.com -From '2026-11-27T00:00:00' -To '2026-11-28T00:00:00'|Out-Null} catch {$failed=$true}
 Check $failed 'Timezone-less calendar range must fail'
 $draftFile=Join-Path $testRoot 'draft.json'
 @{to=@('client@example.com');subject='Proposal';body='Draft for review'}|ConvertTo-Json|Set-Content $draftFile
 $draft=& $script -Action Draft -Account pa@example.com -InputFile $draftFile|ConvertFrom-Json
 Check (-not $draft.sent) 'Draft must not be sent'
 $payload=$global:graphCalls[-1].Body|ConvertFrom-Json
 Check (@($payload.toRecipients).Count -eq 1) 'Single recipient must be an array'
 $synced=& $script -Action SyncBooking -Account pa@example.com -CrmUrl 'https://crm.example.com' -BookingId b|ConvertFrom-Json
 Check $synced.synced 'Booking should sync'
 $eventCall=$global:graphCalls|Where-Object {$_.Method -eq 'POST' -and $_.Uri -like '*/me/events'}|Select-Object -Last 1
 $eventBody=$eventCall.Body|ConvertFrom-Json
 Check ($eventBody.transactionId -eq 'event-crm-b') 'Retry transaction ID must be stable'
 Check ($eventBody.start.timeZone -eq 'GMT Standard Time') 'UK timezone must be explicit'
 $crmPatch=$global:crmCalls[-1].Body|ConvertFrom-Json
 Check ($crmPatch.version -eq 1 -and $crmPatch.outlook_event_id -eq 'event-1') 'Calendar link must use version guard'
 Check (-not ($global:graphCalls|Where-Object {$_.Uri -match '/send|sendMail'})) 'No send endpoint may be called'
 'Outlook mocked checks passed: account, range, draft, recipient, event, version, no-send.'
} finally {
 $env:PSModulePath=$oldModulePath
 $env:CRM_AI_TOKEN=$oldToken
 Remove-Module Microsoft.Graph.Authentication -ErrorAction SilentlyContinue
 Remove-Item Function:\Invoke-RestMethod -ErrorAction SilentlyContinue
}
