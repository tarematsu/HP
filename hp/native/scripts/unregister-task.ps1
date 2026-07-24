[CmdletBinding()]
param([string]$TaskName = "HomePanel Native")
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
