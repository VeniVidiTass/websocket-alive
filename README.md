# Sistema Eventi Real-time con WebSocket

Un sistema completo per la gestione e visualizzazione di eventi in tempo reale, progettato per ambienti che richiedono monitoraggio continuo (come sistemi sanitari, logistici o di monitoraggio). Il sistema utilizza un'architettura moderna basata su Node.js, TypeScript, PostgreSQL e Socket.IO per garantire comunicazione real-time affidabile.

## 🏗️ Architettura del Sistema

### Stack Tecnologico

**Backend:**
- **Node.js 24** - Runtime JavaScript server-side
- **TypeScript** - Type safety e sviluppo scalabile
- **Express.js 5.1** - Framework web minimalista e flessibile
- **Socket.IO 4.8** - Comunicazione WebSocket real-time
- **PostgreSQL 15** - Database relazionale con funzionalità avanzate
- **Docker Compose** - Containerizzazione e orchestrazione

**Frontend:**
- **HTML5/CSS3** - Struttura e stile delle pagine
- **Tailwind CSS** - Framework CSS utility-first
- **Socket.IO Client** - Client WebSocket lato browser
- **JavaScript ES6+** - Logica client-side

## 🔧 Componenti dell'Architettura

### 1. Database PostgreSQL

#### Schema del Database
```sql
-- Tabella principale per gli eventi
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    code VARCHAR(255) NOT NULL,        -- Codice identificativo per raggruppare eventi
    title VARCHAR(255) NOT NULL,       -- Titolo dell'evento
    description TEXT NOT NULL,         -- Descrizione dettagliata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indice per migliorare le performance di ricerca per codice
CREATE INDEX idx_events_code ON events(code);
```

#### Sistema LISTEN/NOTIFY
Il database implementa un sistema di notifiche automatiche usando:

- **Trigger PostgreSQL**: Attivato automaticamente su INSERT, UPDATE, DELETE
- **Funzione PL/pgSQL**: `notify_data_change()` che invia notifiche JSON strutturate
- **Canale NOTIFY**: `data_changes` per comunicazioni asincrone

```sql
-- Funzione che gestisce le notifiche
CREATE OR REPLACE FUNCTION notify_data_change() 
RETURNS TRIGGER AS $$
DECLARE
    notification_data JSON;
BEGIN
    -- Costruisce payload JSON con metadati dell'operazione
    notification_data := json_build_object(
        'table', TG_TABLE_NAME,
        'action', TG_OP,
        'data', row_to_json(NEW),
        'code', NEW.code
    );
    
    -- Invia notifica asincrona
    PERFORM pg_notify('data_changes', notification_data::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 2. Server Node.js/Express

#### Struttura del Server (`src/server.ts`)

Il server è organizzato in diverse sezioni funzionali:

##### Connection Pool PostgreSQL
```typescript
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'events_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
});
```

##### API REST Endpoints

**GET `/api/events/:code`**
- Recupera eventi storici per un codice specifico
- Ordinamento cronologico ascendente
- Gestione errori con status HTTP appropriati

**POST `/api/events`**
- Crea nuovo evento nel database
- Validazione campi obbligatori (code, title, description)
- Trigger PostgreSQL gestisce automaticamente le notifiche

**DELETE `/api/events/:id`**
- Elimina evento specifico per ID
- Verifica esistenza prima dell'eliminazione
- Notifica automatica via PostgreSQL LISTEN/NOTIFY

##### Client WebSocket Manager

Il server mantiene due strutture dati per il tracking dei client:

```typescript
// Set per client connessi
const connectedClients = new Set<string>();

// Mappa codice -> Set di client ID
const clientsByCode = new Map<string, Set<string>>();

// Mappa client ID -> codice (relazione inversa)
const codeByClient = new Map<string, string>();
```

**Gestione Eventi Socket.IO:**

- `connection`: Nuovo client connesso
- `join-code`: Client si unisce al monitoraggio di un codice
- `disconnect`: Cleanup delle strutture dati

##### Database Listener
Sistema dedicato per ascoltare notifiche PostgreSQL:

```typescript
async function setupDatabaseListener() {
  notificationClient = new Client({ /* config */ });
  await notificationClient.connect();
  await notificationClient.query('LISTEN data_changes');
  
  notificationClient.on('notification', (msg) => {
    const payload = JSON.parse(msg.payload);
    // Invia evento specifico ai client del codice
    io.to(payload.code).emit('new-event', payload.data);
  });
}
```

### 3. Client Frontend

#### Pagina Principale (`public/index.html`)

**Caratteristiche UI:**
- Design responsive con Tailwind CSS
- Animazioni CSS per eventi (slideIn, pulse, slideOut)
- Gestione stati di connessione
- Auto-scroll per nuovi eventi

**Funzionalità JavaScript:**

```javascript
// Connessione Socket.IO
const socket = io();

// Gestori eventi real-time
socket.on('new-event', addEventToList);
socket.on('updated-event', updateEventInList);
socket.on('deleted-event', removeEventFromList);
socket.on('historical-events', displayHistoricalEvents);

// Join a codice specifico
function connectToCode() {
    const code = document.getElementById('codeInput').value.trim();
    socket.emit('join-code', code);
}
```

#### Pagina Admin (`public/admin/index.html`)

**Funzionalità Aggiuntive:**
- Form per creazione nuovi eventi
- Eliminazione eventi esistenti
- Monitoraggio real-time come pagina principale
- Interfaccia di amministrazione completa

### 4. Sistema di Containerizzazione

#### Docker Compose (`docker-compose.yml`)

**Servizi Configurati:**

1. **PostgreSQL Container**
   - Immagine: `postgres:15`
   - Volumi: dati persistenti + script inizializzazione
   - Health check per dipendenze

2. **Node.js Application**
   - Build da Dockerfile personalizzato
   - Variabili ambiente per configurazione database
   - Dipendenza da PostgreSQL con health check

3. **pgAdmin** (opzionale)
   - Interfaccia web per gestione database
   - Configurazione automatica

#### Dockerfile Multi-stage

```dockerfile
FROM node:18-alpine

# Install dependencies
COPY package*.json ./
RUN npm ci

# Build TypeScript
COPY . .
RUN npm run build

# Production optimization
RUN npm prune --production

EXPOSE 3000
CMD ["npm", "start"]
```

## 👥 Gestione Avanzata di Utenti, Eventi e WebSocket

### Sistema di Tracking Client Multi-Codice

Il server implementa un sofisticato sistema di tracking per gestire client che possono monitorare diversi codici durante la loro sessione:

#### Strutture Dati del Server

```typescript
// Set per client globalmente connessi
const connectedClients = new Set<string>();

// Mappa bidirectional per gestione codici
const clientsByCode = new Map<string, Set<string>>();  // codice -> set di client ID
const codeByClient = new Map<string, string>();        // client ID -> codice attuale
```

**Vantaggi dell'Architettura:**
- **O(1) lookup**: Accesso costante per trovare client di un codice
- **Cleanup automatico**: Rimozione automatica quando nessun client monitora un codice
- **Migrazione seamless**: Client può cambiare codice senza disconnessioni
- **Memory efficient**: Cleanup immediato di strutture vuote

#### Ciclo di Vita delle Connessioni Client

##### 1. Connessione Iniziale
```javascript
// Client-side: Stabilisce connessione WebSocket
socket = io();
socket.on('connect', () => {
    updateConnectionStatus(true);
    socket.emit('join-code', currentCode);
});
```

```typescript
// Server-side: Registra nuovo client
io.on('connection', (socket) => {
    console.log('Nuovo client connesso:', socket.id);
    connectedClients.add(socket.id);
    // Client è connesso ma non ancora associato a un codice
});
```

##### 2. Join a Codice Specifico (Smart Room Management)
```typescript
socket.on('join-code', async (code: string) => {
    // STEP 1: Gestione migrazione da codice precedente
    const previousCode = codeByClient.get(socket.id);
    if (previousCode && previousCode !== code) {
        socket.leave(previousCode);
        const previousClients = clientsByCode.get(previousCode);
        if (previousClients) {
            previousClients.delete(socket.id);
            // Cleanup automatico se nessun client rimane
            if (previousClients.size === 0) {
                clientsByCode.delete(previousCode);
            }
        }
    }
    
    // STEP 2: Associazione al nuovo codice
    socket.join(code);  // Socket.IO room
    codeByClient.set(socket.id, code);  // Tracciamento client->codice
    
    // STEP 3: Registrazione nella mappa inversa
    if (!clientsByCode.has(code)) {
        clientsByCode.set(code, new Set());
    }
    clientsByCode.get(code)!.add(socket.id);
    
    // STEP 4: Caricamento eventi storici specifici per il codice
    const result = await pool.query(
        'SELECT * FROM events WHERE code = $1 ORDER BY created_at ASC',
        [code]
    );
    socket.emit('historical-events', result.rows);
});
```

##### 3. Disconnessione e Cleanup
```typescript
socket.on('disconnect', () => {
    // STEP 1: Rimozione da set globale
    connectedClients.delete(socket.id);
    
    // STEP 2: Lookup codice tramite mappa inversa (O(1))
    const code = codeByClient.get(socket.id);
    if (code) {
        // STEP 3: Rimozione da set specifico del codice
        const clients = clientsByCode.get(code);
        if (clients) {
            clients.delete(socket.id);
            // STEP 4: Cleanup automatico se set vuoto
            if (clients.size === 0) {
                clientsByCode.delete(code);
            }
        }
        // STEP 5: Rimozione mappa inversa
        codeByClient.delete(socket.id);
    }
});
```

### Sistema Eventi Real-time Bidirezionale

#### Architettura di Notifica a Cascata

**PostgreSQL → Server → Client Specifici**

```sql
-- Trigger automatico su ogni operazione CRUD
CREATE TRIGGER events_notify_trigger
    AFTER INSERT OR UPDATE OR DELETE ON events
    FOR EACH ROW EXECUTE PROCEDURE notify_data_change();
```

#### Flusso Dettagliato degli Eventi

##### Scenario 1: Client Multi-Codice si Connette
```
1. Client apre pagina web
   ↓
2. Stabilisce connessione Socket.IO  [socket.id generato]
   ↓
3. User inserisce codice "PAZIENTE_001"
   ↓
4. socket.emit('join-code', 'PAZIENTE_001')
   ↓
5. Server: clientsByCode.get('PAZIENTE_001').add(socket.id)
   ↓
6. Server: Query eventi storici per PAZIENTE_001
   ↓
7. socket.emit('historical-events', eventsArray)
   ↓
8. Client: displayEvents() con animazioni slideIn
```

##### Scenario 2: Creazione Evento Real-time
```
1. Admin/API: POST /api/events
   ↓
2. Server: INSERT INTO events (code, title, description)
   ↓
3. PostgreSQL: Trigger esegue notify_data_change()
   ↓
4. PostgreSQL: NOTIFY 'data_changes' con payload JSON
   ↓
5. Server Listener: riceve notifica asincrona
   ↓
6. Server: Parse payload + estrae codice evento
   ↓
7. Server: io.to(code).emit('new-event', eventData)
   ↓
8. Client(s): addEventToList() con animazione slideIn
   ↓
9. Client(s): Auto-scroll + aggiornamento contatore
```

##### Scenario 3: Migrazione Client tra Codici
```
Client monitorava: PAZIENTE_001 → vuole monitorare: PAZIENTE_002

1. User inserisce nuovo codice "PAZIENTE_002"
   ↓
2. socket.emit('join-code', 'PAZIENTE_002')
   ↓
3. Server: Rileva previousCode = 'PAZIENTE_001'
   ↓
4. Server: socket.leave('PAZIENTE_001')
   ↓
5. Server: clientsByCode.get('PAZIENTE_001').delete(socket.id)
   ↓
6. Server: Se set vuoto → clientsByCode.delete('PAZIENTE_001')
   ↓
7. Server: socket.join('PAZIENTE_002')
   ↓
8. Server: clientsByCode.get('PAZIENTE_002').add(socket.id)
   ↓
9. Server: Query + send eventi storici PAZIENTE_002
   ↓
10. Client: Clearpage + display new eventi
```

### Gestione Stati e Resilienza

#### Auto-Reconnection e Keep-Alive
```javascript
// Client-side: Ping automatico ogni 30 secondi
setInterval(() => {
    if (socket && socket.connected) {
        socket.emit('ping');
    }
}, 30000);

// Gestione disconnect/reconnect automatica
socket.on('disconnect', () => {
    updateConnectionStatus(false);
    // Socket.IO gestisce auto-reconnection
});

socket.on('reconnect', () => {
    // Re-join automatico al codice precedente
    if (currentCode) {
        socket.emit('join-code', currentCode);
    }
});
```

#### Stati di Connessione UI
```javascript
function updateConnectionStatus(connected) {
    const statusElement = document.getElementById('connectionStatus');
    if (connected) {
        statusElement.textContent = `🟢 Connesso e in ascolto su: ${currentCode}`;
        statusElement.className = 'bg-green-100 text-green-800';
    } else {
        statusElement.textContent = '🔴 Connessione persa';
        statusElement.className = 'bg-red-100 text-red-800';
    }
}
```

### Performance e Ottimizzazioni

#### Indexed Database Queries
```sql
-- Indice specifico per query by-code (utilizzato frequentemente)
CREATE INDEX idx_events_code ON events(code);

-- Query ottimizzata per eventi storici
SELECT * FROM events WHERE code = $1 ORDER BY created_at ASC;
```

#### Memory Management
- **Client Set auto-cleanup**: Rimozione automatica di Set vuoti
- **Connection pooling**: PostgreSQL pool per gestione connessioni
- **Event throttling**: PostgreSQL NOTIFY pre-aggregazione automatica
- **DOM optimization**: Virtual scrolling per grandi liste eventi

#### Scalabilità Orizzontale
```typescript
// Preparato per Redis adapter per cluster Socket.IO
const io = new Server(server, {
  adapter: redisAdapter(redis.createClient()),  // Per multi-instance
  transports: ['websocket', 'polling'],          // Fallback transport
  pingTimeout: 60000,                            // Keep-alive tuning
  pingInterval: 25000
});
```

## 🔄 Flusso di Comunicazione Dettagliato

### Scenario 1: Client si Connette
1. Client carica pagina e stabilisce connessione Socket.IO
2. Client emette evento `join-code` con codice specifico
3. Server aggiunge client al room del codice
4. Server invia eventi storici via `historical-events`
5. Client visualizza eventi esistenti

### Scenario 2: Nuovo Evento Creato
1. Admin/API crea evento via POST `/api/events`
2. PostgreSQL INSERT trigger esegue `notify_data_change()`
3. Funzione invia notifica JSON al canale `data_changes`
4. Server riceve notifica via connection listener dedicata
5. Server emette `new-event` ai client del room specifico
6. Client ricevono evento e aggiornano UI con animazioni

### Scenario 3: Evento Eliminato
1. Admin elimina evento via DELETE `/api/events/:id`
2. PostgreSQL DELETE trigger notifica eliminazione
3. Server riceve notifica con dati evento eliminato
4. Server emette `deleted-event` ai client interessati
5. Client rimuovono evento con animazione slideOut

## 🚀 Deployment e Configurazione

### Variabili Ambiente

```bash
NODE_ENV=production
DB_HOST=postgres
DB_PORT=5432
DB_NAME=events_db
DB_USER=postgres
DB_PASSWORD=password
PORT=3000
```

### Comandi di Avvio

```bash
# Sviluppo locale
npm run dev

# Build TypeScript
npm run build

# Produzione
npm start

# Docker Compose
docker-compose up -d
```

### Health Checks e Monitoring

- PostgreSQL health check integrato
- Graceful shutdown con cleanup connessioni
- Auto-reconnection Socket.IO
- Keep-alive ping ogni 30 secondi

## 🔒 Sicurezza e Performance

### Misure di Sicurezza
- Escape HTML per prevenire XSS
- Validazione input server-side
- Connessioni database con pool per efficiency
- Rate limiting implicito via Socket.IO

### Ottimizzazioni Performance
- Indici database su colonne frequently accessed
- Connection pooling PostgreSQL
- Lazy loading eventi storici
- Cleanup automatico client disconnessi
- TypeScript per error catching a compile time

## 📊 Monitoring e Logging

Il sistema include logging dettagliato per:
- Connessioni/disconnessioni client
- Operazioni database
- Notifiche PostgreSQL
- Errori e eccezioni
- Tracking client per codice

## 🔧 Estensibilità

Il sistema è progettato per essere facilmente estendibile:

- **Nuovi tipi di evento**: Aggiunta campi alla tabella events
- **Autenticazione**: Middleware Express per route protette
- **Rate limiting**: Redis per gestione quota per client
- **Multiple databases**: Pattern repository per astrazione data layer
- **Microservizi**: Separazione concerns in servizi dedicati

## 📝 Note di Sviluppo

- TypeScript fornisce type safety end-to-end
- PostgreSQL LISTEN/NOTIFY garantisce real-time affidabile
- Socket.IO gestisce autamaticamente fallback e reconnection
- Docker permette deployment consistent cross-platform
- Tailwind CSS accelera sviluppo UI responsive

Questo sistema rappresenta un'implementazione production-ready per applicazioni che richiedono aggiornamenti real-time affidabili con persistenza dati e scalabilità orizzontale.
