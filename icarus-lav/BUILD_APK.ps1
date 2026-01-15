# ===============================================
# ICARUS.LAV - Build do APK Android
# ===============================================

Write-Host "========================================" -ForegroundColor Magenta
Write-Host "   ICARUS.LAV - Build Android APK" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

# Navegar para o diretório do projeto
Set-Location "c:\Users\Eduardo\Desktop\Icarus\icarus-lav"

# Sincronizar arquivos web com Android
Write-Host "[1/3] Sincronizando arquivos web..." -ForegroundColor Cyan
npx cap sync android

# Navegar para o diretório Android
Set-Location android

# Build do APK
Write-Host "[2/3] Gerando APK (pode demorar alguns minutos)..." -ForegroundColor Cyan
.\gradlew.bat assembleDebug

# Verificar se o APK foi gerado
$apkPath = "app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apkPath) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "   APK GERADO COM SUCESSO!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Caminho do APK:" -ForegroundColor Yellow
    Write-Host "  $((Get-Location).Path)\$apkPath" -ForegroundColor White
    Write-Host ""
    
    # Copiar para pasta mais acessível
    $destPath = "c:\Users\Eduardo\Desktop\Icarus\icarus-lav\IcarusLAV.apk"
    Copy-Item $apkPath $destPath -Force
    Write-Host "APK copiado para:" -ForegroundColor Yellow
    Write-Host "  $destPath" -ForegroundColor White
    Write-Host ""
    Write-Host "Envie este arquivo para o celular da Dany!" -ForegroundColor Magenta
} else {
    Write-Host ""
    Write-Host "ERRO: APK nao foi gerado" -ForegroundColor Red
    Write-Host "Verifique os erros acima" -ForegroundColor Red
}

Set-Location "c:\Users\Eduardo\Desktop\Icarus\icarus-lav"
