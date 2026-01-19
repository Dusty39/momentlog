# MomentLog 📸

**Anılarını Ölümsüzleştir.**
MomentLog, kullanıcıların günlük anılarını fotoğraf, ses kaydı, müzik ve konum bilgisiyle zenginleştirerek saklayabildiği ve ("Arkadaş" veya "Herkes" ile) paylaşabildiği modern bir sosyal günlük uygulamasıdır.

![MomentLog Banner](https://via.placeholder.com/1200x500/121212/00e676?text=MomentLog+PWA)

## 🌟 Öne Çıkan Özellikler

*   **📱 PWA (Progressive Web App):** Uygulama mağazasına gerek kalmadan telefonuna yükle, çevrimdışı çalış.
*   **🤝 Sosyal Etkileşim:**
    *   **Karşılıklı Takip = Arkadaşlık:** Seni takip edeni sen de takip edersen otomatik "Arkadaş" olursunuz.
    *   **Gelişmiş Gizlilik:** Anılarını "Sadece Ben", "Sadece Arkadaşlar" veya "Herkese Açık" olarak paylaş.
*   **🎙️ Zengin İçerik:**
    *   Spotify entegrasyonu ile anına şarkı ekle.
    *   Dahili ses kaydedici ile sesli notlar bırak.
    *   Konum doğrulama (Verified Location).
*   **🛡️ Güvenlik Kalkanı:**
    *   Firestore Rules ile backend tabanlı veri doğrulama.
    *   Premium kullanıcılar için arttırılmış limitler (500 karakter).
    *   XSS koruması ve içerik filtreleri.
*   **🎨 Kişiselleştirme:** Minimal, Vintage, Dark ve daha fazla tema seçeneği.

## 🛠️ Teknolojiler

Bu proje, "Vanilla" felsefesiyle, framework bağımlılığı olmadan saf performans için geliştirilmiştir.

*   **Frontend:** HTML5, CSS3 (Modern Variables & Grid), Vanilla JavaScript (ES6+)
*   **Backend & DB:** Firebase (Firestore, Auth, Hosting)
*   **Medya Depolama:** Cloudinary (Resim ve Ses optimizasyonu için)
*   **Haritalar:** OpenStreetMap & Nominatim API

## 🚀 Kurulum

Projeyi kendi bilgisayarında çalıştırmak için:

1.  **Repoyu Klonla:**
    ```bash
    git clone https://github.com/dusty39/momentLog.git
    cd momentLog
    ```

2.  **Firebase Ayarları:**
    *   `firebase-config.js` dosyasını kendi proje bilgilerinizle güncelleyin.
    *   Konsoldan Firestore ve Auth servislerini aktif edin.

3.  **Çalıştır:**
    Herhangi bir yerel sunucu ile (örn: Live Server) `index.html` dosyasını açın.

## 🔒 Güvenlik Kuralları (Firestore)

Proje, veritabanı bütünlüğü için sıkı `firestore.rules` kullanır.
*   Kullanıcılar sadece kendi verilerini değiştirebilir.
*   "Arkadaşa Özel" içerikleri sadece arkadaş listesindekiler okuyabilir.
*   Karakter limitleri sunucu tarafında zorunlu tutulur.

## 📜 Lisans

Bu proje [MIT Lisansı](LICENSE) ile lisanslanmıştır.

---
*Created with ❤️ & ☕ by Serhat Aykış*
