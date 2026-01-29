/**
 * Cloudinary Media Upload Service
 * Handles client-side unsigned uploads for images and audio.
 */
const CloudinaryService = {
    CLOUD_NAME: 'diay4lvx1',
    UPLOAD_PRESET: 'momentlog',

    /**
     * Uploads media (base64 or Blob) to Cloudinary
     * @param {string|Blob} fileData - The file data to upload
     * @param {string} type - 'image' or 'audio'
     * @returns {Promise<string>} - The secure URL of the uploaded asset
     */
    async upload(fileData, type = 'image') {
        const url = `https://api.cloudinary.com/v1_1/${this.CLOUD_NAME}/upload`;

        const formData = new FormData();
        formData.append('file', fileData);
        formData.append('upload_preset', this.UPLOAD_PRESET);

        // Audio and Video files belong to 'video' resource type in Cloudinary
        const resourceType = (type === 'audio' || type === 'video') ? 'video' : 'image';

        try {
            const response = await fetch(url, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || 'Cloudinary yükleme hatası');
            }

            const data = await response.json();
            return data.secure_url;
        } catch (err) {
            console.error('Cloudinary Upload Error:', err);
            throw err;
        }
    }
};
