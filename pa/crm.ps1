[CmdletBinding()]
param(
 [ValidateSet('Health','List','Get','Create','Update','CreateTask','UpdateTask')]
 [string]$Action='Health',
 [string]$BookingId,
 [string]$TaskId,
 [string]$InputFile,
 [string]$Query,
 [string]$From,
 [string]$To
)
$ErrorActionPreference='Stop'
$origin=$env:CRM_BASE_URL
if(-not $origin){$origin='https://event-crm-c8u.pages.dev'}
$parsed=[uri]$origin
if($parsed.Scheme -ne 'https' -or $parsed.AbsolutePath -ne '/' -or $parsed.Query -or $parsed.Fragment){throw 'CRM_BASE_URL must be an HTTPS origin.'}
$headers=@{}
if($env:CRM_AI_TOKEN){$headers.Authorization='Bearer '+$env:CRM_AI_TOKEN}
if($env:CF_ACCESS_CLIENT_ID -and $env:CF_ACCESS_CLIENT_SECRET){
 $headers['CF-Access-Client-Id']=$env:CF_ACCESS_CLIENT_ID
 $headers['CF-Access-Client-Secret']=$env:CF_ACCESS_CLIENT_SECRET
}
$path='/api/ai/health';$method='GET';$body=$null
if($Action -ne 'Health' -and -not $env:CRM_AI_TOKEN){throw 'Hermes CRM credentials have not been configured. Ask the owner to authorise the connection.'}
if($Action -in @('Get','Update','CreateTask','UpdateTask') -and -not $BookingId){throw 'BookingId is required.'}
if($Action -in @('Create','Update','CreateTask','UpdateTask')){
 if(-not $InputFile){throw 'InputFile containing a JSON object is required.'}
 $body=Get-Content -LiteralPath $InputFile -Raw | ConvertFrom-Json -AsHashtable
 if($body -isnot [Collections.IDictionary]){throw 'Expected a JSON object.'}
 if($Action -ne 'Create' -and ($body.version -isnot [long] -and $body.version -isnot [int])){throw 'Read the booking and supply its integer version.'}
 if($Action -ne 'Create' -and $body.version -lt 1){throw 'Version must be positive.'}
}
$booking=[uri]::EscapeDataString($BookingId)
switch($Action){
 'List' {
  $params=@()
  foreach($pair in @(@('q',$Query),@('from',$From),@('to',$To))){if($pair[1]){$params+=($pair[0]+'='+[uri]::EscapeDataString($pair[1]))}}
  $path='/api/ai/bookings';if($params.Count){$path+='?'+($params -join '&')}
 }
 'Get' {$path='/api/ai/bookings/'+$booking}
 'Create' {$path='/api/ai/bookings';$method='POST'}
 'Update' {$path='/api/ai/bookings/'+$booking;$method='PATCH'}
 'CreateTask' {$path='/api/ai/bookings/'+$booking+'/tasks';$method='POST'}
 'UpdateTask' {
  if(-not $TaskId){throw 'TaskId is required.'}
  $path='/api/ai/bookings/'+$booking+'/tasks/'+[uri]::EscapeDataString($TaskId);$method='PATCH'
 }
}
$options=@{Uri=($origin.TrimEnd('/')+$path);Method=$method;Headers=$headers;MaximumRedirection=0}
if($null -ne $body){$options.Body=($body|ConvertTo-Json -Depth 30 -Compress);$options.ContentType='application/json'}
try {
 $result=Invoke-RestMethod @options
 if($Action -eq 'List' -and $result.count -ge 100){Write-Warning 'This endpoint returns at most 100 bookings. Narrow the date range before treating this as a complete task review.'}
 $result|ConvertTo-Json -Depth 30
} catch {
 $status=[int]$_.Exception.Response.StatusCode
 if($status -eq 409){throw 'CRM conflict: another writer saved first. Read the booking again and reapply only the intended change.'}
 if($status -eq 428){throw 'Read the booking first and supply its current version.'}
 if($status -in @(301,302,303,307,308,401,403)){throw 'CRM authentication failed. Verify the Hermes AI token and Cloudflare Access service credentials.'}
 throw
}
