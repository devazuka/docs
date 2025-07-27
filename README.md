# DOCUMENT DB SYSTEM 2000

- AI for:
  - Auto Tags
    - Date
    - Validity
    - Category (bill | administration | etc...)
    - Language
    - ...
  - Description
  - Vector Search
- QR code data reader
- Duplicate finders
- Auto image optimisation
  - Perspective
  - Truncate
  - Fix saturation / contrast / white balance
- UI to upload
- UI to browse & search & download
- PWA (or android app if not possible)
  - to be able to be a target from "share to..."
  - to take pictures and add them automatically
- Collections (make arbitrary groups of files to)

MVP:

1. API to upload files
2. UI to upload files
3. auto derive compressed media (keep originals)
4. Simple auth (user:password, standard http spec)
5. Generate description using GEMINI API
6. Tagger Service (Generate tags using GEMINI API)
7. OCR Service (explore solutions for that)
8. Implement vector search (integrate with mielisearch?)
