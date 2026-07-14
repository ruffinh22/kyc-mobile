@if "%DEBUG%"=="" @echo off
@rem ##########################################################################
@rem
@rem Gradle startup script for Windows
@rem
@rem ##########################################################################

@rem Set local scope for the variables with windows NT shell
if "%OS%"=="Windows_NT" setlocal

setlocal enabledelayedexpansion

set DIRNAME=%~dp0
if "%DIRNAME%"=="" set DIRNAME=.

set APP_BASE_NAME=%~n0
set APP_HOME=%DIRNAME%..

set GRADLE_HOME=%USERPROFILE%\.gradle
set GRADLE_WRAPPER_DIR=%GRADLE_HOME%\wrapper\dists\gradle-8.1.1-all

if not exist "%GRADLE_WRAPPER_DIR%" (
  echo Downloading Gradle 8.1.1...
  mkdir "%GRADLE_HOME%\wrapper\dists" 2>nul
  powershell -Command "(New-Object Net.WebClient).DownloadFile('https://services.gradle.org/distributions/gradle-8.1.1-all.zip', '%GRADLE_HOME%\wrapper\gradle-8.1.1-all.zip')"
  powershell -Command "Expand-Archive '%GRADLE_HOME%\wrapper\gradle-8.1.1-all.zip' -DestinationPath '%GRADLE_HOME%\wrapper\dists'"
)

for /d %%i in ("%GRADLE_HOME%\wrapper\dists\gradle-8.1.1*") do set GRADLE_HOME_DIR=%%i

"%GRADLE_HOME_DIR%\bin\gradle.bat" %*
