$ErrorActionPreference='Stop'
$paRoot=Join-Path ([IO.Path]::GetTempPath()) ('quirky-pa-test-'+[guid]::NewGuid())
New-Item -ItemType Directory -Path $paRoot -Force|Out-Null
$paInput=Join-Path $paRoot 'task.json'
$paScript=Join-Path $PSScriptRoot '../pa/crm.ps1'
$paOldToken=$env:CRM_AI_TOKEN;$paOldBase=$env:CRM_BASE_URL
$env:CRM_AI_TOKEN='test-only';$env:CRM_BASE_URL='https://crm.example.com'
$global:paCalls=[Collections.Generic.List[object]]::new()
function global:Invoke-RestMethod {
 param($Uri,$Method,$Headers,$MaximumRedirection,$Body,$ContentType)
 $global:paCalls.Add(@{Uri=$Uri;Method=$Method;Headers=$Headers;MaximumRedirection=$MaximumRedirection;Body=$Body})
 return @{version=2;count=0;items=@()}
}
function Check($condition,$message){if(-not $condition){throw $message}}
try{
 @{version=1;title='Prepare proposal'}|ConvertTo-Json|Set-Content $paInput
 $null=& $paScript -Action CreateTask -BookingId 'booking/one' -InputFile $paInput
 Check ($global:paCalls[-1].Uri -eq 'https://crm.example.com/api/ai/bookings/booking%2Fone/tasks') 'Booking ID must be encoded as one path segment'
 Check ($global:paCalls[-1].Method -eq 'POST') 'Task creation must use POST'
 Check ($global:paCalls[-1].MaximumRedirection -eq 0) 'Credentials must not follow redirects'
 $body=$global:paCalls[-1].Body|ConvertFrom-Json
 Check ($body.version -eq 1) 'Version guard must be forwarded'
 $before=$global:paCalls.Count
 @{title='Stale overwrite'}|ConvertTo-Json|Set-Content $paInput
 $failed=$false;try{& $paScript -Action CreateTask -BookingId one -InputFile $paInput|Out-Null}catch{$failed=$true}
 Check ($failed -and $global:paCalls.Count -eq $before) 'Missing version must fail before an HTTP call'
 $env:CRM_AI_TOKEN=''
 $failed=$false;try{& $paScript -Action List|Out-Null}catch{$failed=$true}
 Check ($failed -and $global:paCalls.Count -eq $before) 'Missing credentials must fail before an HTTP call'
 'PA CRM connector checks passed.'
}finally{
 $env:CRM_AI_TOKEN=$paOldToken;$env:CRM_BASE_URL=$paOldBase
 Remove-Item Function:\Invoke-RestMethod -ErrorAction SilentlyContinue
}
