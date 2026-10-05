FROM node:22-slim

# LibreOffice headless handles docx/pptx/xlsx/odt/etc conversion to PDF.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=4000
EXPOSE 4000

CMD ["node", "server.js"]
