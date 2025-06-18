# Usa l'immagine Node.js ufficiale
FROM node:24-alpine

# Installa curl per health check
RUN apk add --no-cache curl

# Crea la directory dell'app
WORKDIR /app

# Copia i file package.json e package-lock.json
COPY package*.json ./

# Installa TUTTE le dipendenze (incluse quelle di sviluppo per la compilazione)
RUN npm ci

# Copia il codice sorgente
COPY . .

# Compila TypeScript
RUN npm run build

# Rimuovi le dipendenze di sviluppo dopo la compilazione
RUN npm prune --production

# Esponi la porta 3000
EXPOSE 3000

# Comando per avviare l'applicazione
CMD ["npm", "start"]
