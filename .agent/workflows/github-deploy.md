---
description: GitHub'a Gönderilmesi Gereken Dosyalar
---

Her güncellemeden sonra GitHub repovuzu güncel tutmak için aşağıdaki dosyaları (değişiklik yapılmışsa) göndermelisiniz:

### 1. Temel Dosyalar (Her zaman güncellenmeli)
- `app.js`: Uygulama mantığı ve yeni özellikler buradadır.
- `style.css`: Görsel düzenlemeler ve yeni temalar buradadır.
- `index.html`: Sayfa yapısı ve yeni HTML elementleri buradadır.
- `sw.js`: Önbellek (cache) sürümü güncellendiğinde mutlaka gönderilmelidir.

### 2. Yapılandırma ve Servis Dosyaları
- `firebase-service.js`: Veritabanı işlemleri veya Firebase mantığı değiştiğinde.
- `story-mode.js`: Hikaye modu/sürükleyici görünüm mantığı değiştiğinde.
- `manifest.json`: PWA ayarları veya uygulama ikonu/ismi değiştiğinde.

### 3. Güvenlik (Nadiren değişir)
- `firestore.rules`: Veritabanı erişim kuralları güncellendiğinde.

### Örnek Git Komutları:
```bash
git add app.js style.css sw.js index.html
git commit -m "v126: Zaman çıkartması ve tasarım iyileştirmesi"
git push origin main
```
