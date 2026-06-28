' Runs the Laravel scheduler hidden (no console window). Invoked every minute by
' the "TibiaAtlas Scheduler" task; fires tibia:etl-killstats hourly.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\David\Documents\web tibia\backend"
sh.Run """C:\Users\David\AppData\Local\Microsoft\WinGet\Packages\PHP.PHP.8.4_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe"" artisan schedule:run", 0, False
