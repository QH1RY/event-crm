[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidateSet('Collect','Ingest')][string]$Action,
 [string]$Since,[string]$Until,[string]$InputFile,
 [Parameter(Mandatory=$true)][string]$OutputFile,
 [string]$HermesHome=$env:HERMES_HOME
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
if(-not $HermesHome){$HermesHome=Join-Path $env:LOCALAPPDATA 'hermes'}
if($Action -eq 'Collect'){
 if($Since -notmatch 'Z$' -or $Until -notmatch 'Z$'){throw 'Explicit UTC timestamps ending in Z are required.'}
 [void][datetimeoffset]::Parse($Since);[void][datetimeoffset]::Parse($Until)
 if([datetimeoffset]$Since -gt [datetimeoffset]$Until){throw 'Since must not follow Until.'}
 $enqOutlook=Join-Path $HermesHome 'integrations/outlook.ps1'
 if(-not (Test-Path -LiteralPath $enqOutlook)){throw 'Existing authorised Outlook integration was not found.'}
 . $enqOutlook -Action Status
 if(-not $script:outlookAccount){throw 'Saved Microsoft sign-in is unavailable. Owner sign-in is required; no interactive login was started.'}
 if($script:outlookAccount -ine 'info@quirky-hire.co.uk'){throw 'Mailbox safety check failed.'}
 $enqFilter=[uri]::EscapeDataString(('receivedDateTime ge '+$Since+' and receivedDateTime le '+$Until))
 $enqPage=Graph GET ('/me/mailFolders/inbox/messages?$filter='+$enqFilter+'&$select=id,subject,from,toRecipients,receivedDateTime,body,conversationId,webLink&$orderby=receivedDateTime asc&$top=100')
 @{mailbox=$script:outlookAccount;messages=@($enqPage.value);has_more=[bool]$enqPage.'@odata.nextLink'}|ConvertTo-Json -Depth 18|Set-Content -Encoding UTF8 -LiteralPath $OutputFile
 Write-Output 'Read-only inbox collection complete.'
 return
}
if(-not $InputFile){throw 'An input file is required for explicit CRM ingestion.'}
$enqLoader=Join-Path $HermesHome 'integrations/crm-secrets.ps1'
if(Test-Path -LiteralPath $enqLoader){. $enqLoader;Import-CrmCredentials|Out-Null}
if(-not $env:CRM_AI_TOKEN){throw 'The existing Hermes CRM identity is unavailable. No alternative credentials were created.'}
$enqOrigin=$env:CRM_BASE_URL
if(-not $enqOrigin){$enqOrigin='https://event-crm-c8u.pages.dev'}
$enqUri=[uri]$enqOrigin
if($enqUri.Scheme -ne 'https' -or $enqUri.AbsolutePath -ne '/' -or $enqUri.Query -or $enqUri.Fragment){throw 'CRM origin must be an HTTPS origin without path, query or fragment.'}
$enqHeaders=@{Authorization=('Bearer '+$env:CRM_AI_TOKEN)}
if($env:CF_ACCESS_CLIENT_ID -and $env:CF_ACCESS_CLIENT_SECRET){$enqHeaders['CF-Access-Client-Id']=$env:CF_ACCESS_CLIENT_ID;$enqHeaders['CF-Access-Client-Secret']=$env:CF_ACCESS_CLIENT_SECRET}
$enqItems=@(Get-Content -Raw -Encoding UTF8 -LiteralPath $InputFile|ConvertFrom-Json)
if($enqItems.Count -gt 20){throw 'More than 20 candidate enquiries need controlled backfill; no CRM writes attempted.'}
$enqReceipts=@()
foreach($enqItem in $enqItems){
 if($enqItem.status -ne 'New enquiry' -or $enqItem.source_mailbox -ine 'info@quirky-hire.co.uk'){throw 'Intake may create only New enquiry records from the verified mailbox.'}
 $enqResponse=Invoke-WebRequest -UseBasicParsing -Method POST -Uri ($enqOrigin.TrimEnd('/')+'/api/ai/enquiries') -Headers $enqHeaders -ContentType 'application/json; charset=utf-8' -Body ($enqItem|ConvertTo-Json -Depth 15 -Compress) -MaximumRedirection 0 -TimeoutSec 25
 $enqSaved=$enqResponse.Content|ConvertFrom-Json
 if(-not $enqSaved.id){throw 'The CRM did not return an enquiry ID. Check the source key before retrying.'}
 $enqReceipt=@{id=$enqSaved.id;created=([int]$enqResponse.StatusCode -eq 201);reference=$enqSaved.reference;client_name=$enqSaved.client_name;verified=$false}
 $enqReceipts+= $enqReceipt
 ConvertTo-Json -InputObject @($enqReceipts) -Depth 12|Set-Content -Encoding UTF8 -LiteralPath $OutputFile
 $enqCheck=Invoke-RestMethod -Method GET -Uri ($enqOrigin.TrimEnd('/')+'/api/ai/enquiries/'+[uri]::EscapeDataString($enqSaved.id)) -Headers $enqHeaders -MaximumRedirection 0 -TimeoutSec 25
 if($enqCheck.id -ne $enqSaved.id -or $enqCheck.source_mailbox -ine $enqItem.source_mailbox){throw 'CRM enquiry read-back did not match; do not blindly recreate it.'}
 if($enqItem.source_conversation_id -and $enqCheck.source_conversation_id -ne $enqItem.source_conversation_id){throw 'CRM source conversation verification failed; existing data was not overwritten.'}
 $enqReceipt.verified=$true
 ConvertTo-Json -InputObject @($enqReceipts) -Depth 12|Set-Content -Encoding UTF8 -LiteralPath $OutputFile
}
Write-Output 'Controlled enquiry API writes and read-back verification completed.'
