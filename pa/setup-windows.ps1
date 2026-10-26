# Run this helper from a normal PowerShell 7 session under the owner's Windows account.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$paRepo=Split-Path -Parent $PSScriptRoot
$paWorkspace=Split-Path -Parent $paRepo
$paResult=Join-Path $paWorkspace 'work/hermes-install-result.json'
$paHome=Join-Path $env:LOCALAPPDATA 'hermes'
$paExistingProfile=Test-Path -LiteralPath (Join-Path $paHome 'config.yaml')
try {
 $paInstaller=Join-Path $paWorkspace 'work/hermes-install.ps1'
 if(-not (Test-Path -LiteralPath $paInstaller)){
  Invoke-WebRequest -Uri 'https://hermes-agent.nousresearch.com/install.ps1' -OutFile $paInstaller
 }
 & $paInstaller -NonInteractive -SkipBrowser -SkipComputerUse
 if($LASTEXITCODE -ne 0){throw 'The official Hermes installer did not finish successfully.'}
 if(-not (Test-Path -LiteralPath (Join-Path $paHome 'bin'))){throw 'Hermes launcher directory was not created.'}
 $paTargetSoul=Join-Path $paHome 'SOUL.md'
 if($paExistingProfile){
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'SOUL.md') -Destination (Join-Path $paHome 'SOUL.quirky-pa.md') -Force
 } else {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'SOUL.md') -Destination $paTargetSoul -Force
 }
 $paIntegrations=Join-Path $paHome 'integrations'
 New-Item -ItemType Directory -Path $paIntegrations -Force | Out-Null
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'crm.ps1') -Destination (Join-Path $paIntegrations 'crm.ps1') -Force
 Copy-Item -LiteralPath (Join-Path $paRepo 'scripts/outlook.ps1') -Destination (Join-Path $paIntegrations 'outlook.ps1') -Force
 $paModules=Join-Path $paIntegrations 'modules'
 New-Item -ItemType Directory -Path $paModules -Force | Out-Null
 $paSourceModule=Join-Path $paWorkspace 'work/outlook-modules/Microsoft.Graph.Authentication'
 if(Test-Path -LiteralPath $paSourceModule){
  Copy-Item -LiteralPath $paSourceModule -Destination $paModules -Recurse -Force
 }
 $paTasks=Join-Path $paHome 'tasks'
 New-Item -ItemType Directory -Path $paTasks -Force | Out-Null
 if(-not (Test-Path -LiteralPath (Join-Path $paTasks 'personal-tasks.json'))){Set-Content -LiteralPath (Join-Path $paTasks 'personal-tasks.json') -Value '[]'}
 $paEnvPath=Join-Path $paHome '.env'
 $paEnvText=if(Test-Path -LiteralPath $paEnvPath){Get-Content -LiteralPath $paEnvPath -Raw}else{''}
 foreach($paEntry in @('HERMES_TIMEZONE=Europe/London','OUTLOOK_ACCOUNT=info@quirky-hire.co.uk','CRM_BASE_URL=https://event-crm-c8u.pages.dev')){
  $paKey=($paEntry -split '=',2)[0]
  if($paEnvText -notmatch ('(?m)^'+[regex]::Escape($paKey)+'=')){Add-Content -LiteralPath $paEnvPath -Value $paEntry}
 }
 $env:PATH=(Join-Path $paHome 'bin')+';'+$env:PATH
 $paCommand=Get-Command hermes -ErrorAction Stop
 & $paCommand.Source --version
 if($LASTEXITCODE -ne 0){throw 'Hermes installed but its version check failed.'}
 @{installed=$true;home=$paHome;profile_applied=(-not $paExistingProfile);model_connected=$false;crm_connected=$false;reminders_enabled=$false;checked_at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $paResult
 Write-Host ''
 Write-Host 'HERMES_PA_INSTALLED'
 Write-Host 'Model login, CRM credentials and reminder delivery still need configuration.'
 Write-Host 'Opening model setup. Choose ChatGPT or Codex Subscription to use your existing eligible account.'
 & $paCommand.Source model
} catch {
 @{installed=$false;error=$_.Exception.Message;checked_at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $paResult
 throw
}
