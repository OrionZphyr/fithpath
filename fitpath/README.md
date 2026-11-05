# Fitpath

Fitpath is a responsive fitness tracker built with browser JavaScript, Node.js, and SQLite. It supports activity, workout, nutrition, hydration, body, sleep, and goal logs. User accounts use password hashing.

## Run on a Windows 10 school computer

You do not need to install Node.js or have administrator permissions. Download and extract the W2 project into a folder you can write to, then run these commands in PowerShell:

```powershell
cd "C:\path\to\Fitpath Fitness Tracker W2 (Week 2)"
powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-Fitpath.ps1
```

On first launch, the script downloads the official 64-bit Node.js runtime into `runtime\node.exe` and checks its SHA-256 before running the app. The download is about 87 MB and requires internet access once. Later launches reuse that file. The launcher does not install Node.js or modify system settings. If the school blocks downloading or running portable programs, use the hosted Render site or ask the lab administrator what is allowed.

Keep the PowerShell window open while Fitpath is running, then open http://localhost:4173 in a browser. Press Ctrl+C in PowerShell to stop it. Fitpath stores its local database in `data\fitpath.sqlite` inside this project folder.

## Run with Node.js already installed

Use Node.js 22.5 or newer:

```powershell
npm.cmd start
```

Then visit http://localhost:4173.

## Render deployment

- Root Directory: leave blank when the W2 files are at the repository root.
- Build Command: `npm install`.
- Start Command: `node server.js`.

The server listens on `0.0.0.0` and uses Render's `PORT` variable when present. Render's free filesystem is temporary, so its local SQLite database can be lost on restart or spin-down. This setup is suitable for a demo, not durable hosted data.

## Signup and limitations

Signup asks for a name, email, password confirmation, and gender. Height and weight are optional and used to calculate BMI. After signup, the email is prefilled on the sign-in form. Password reset, email confirmation, wearable connections, GPS tracking, and a full administration interface are not included.