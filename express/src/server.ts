import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Pool, Client } from 'pg';
import path from 'path';

const app = express();
const server = createServer(app);
const io = new Server(server);

// Configurazione database PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'alive_logs_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
});

// Client dedicato per LISTEN
let notificationClient: Client | null = null;

// Middleware per il parsing del JSON
app.use(express.json());

// Interfaccia per gli eventi
interface Event {
  id: number;
  code: string;
  title: string;
  description: string;
  created_at: Date;
}

// Interfaccia per le notifiche PostgreSQL
interface NotificationPayload {
  table: string;
  action: string;
  data: Event;
  code: string;
}

// Set per tenere traccia dei client connessi
const connectedClients = new Set<string>();

// Mappa per raggruppare client per codice
const clientsByCode = new Map<string, Set<string>>();

// Mappa per tracciare quale codice sta monitorando ogni client (indirezione inversa)
const codeByClient = new Map<string, string>();
// Endpoint per servire la pagina principale
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Endpoint di health check
app.get('/health', async (req: Request, res: Response) => {
  try {
    // Verifica connessione al database
    await pool.query('SELECT 1');

    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      connectedClients: connectedClients.size
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Endpoint per ottenere gli eventi storici
app.get('/api/alive/:code', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const result = await pool.query(
      'SELECT * FROM alive_logs WHERE code = $1 ORDER BY created_at ASC',
      [code]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Errore nel recupero degli eventi:', error);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// Configurazione modalità applicazione
const MODE = process.env.MODE || 'production';
const isDebugMode = MODE === 'debug' || MODE === 'development';

console.log(`Modalità applicazione: ${MODE}`);

if (isDebugMode) {
  // Endpoint per servire la pagina admin (solo in modalità debug)
  app.get('/admin/', (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '../public/admin/index.html'));
  });

  // Endpoint per creare un nuovo evento
  app.post('/api/alive', async (req: Request, res: Response) => {
    try {
      const { code, title, description } = req.body;

      if (!code || !title || !description) {
        return res.status(400).json({ error: 'Tutti i campi sono obbligatori' });
      }

      // Inserisci l'evento nel database - il trigger PostgreSQL invierà la notifica
      const result = await pool.query(
        'INSERT INTO alive_logs (code, title, description) VALUES ($1, $2, $3) RETURNING *',
        [code, title, description]
      );

      const newEvent = result.rows[0];
      console.log('Nuovo evento creato:', newEvent);

      // Il trigger PostgreSQL gestirà automaticamente la notifica LISTEN/NOTIFY
      // Non inviamo direttamente tramite Socket.IO qui

      res.status(201).json(newEvent);
    } catch (error) {
      console.error('Errore nella creazione dell\'evento:', error);
      res.status(500).json({ error: 'Errore interno del server' });
    }
  });

  // Endpoint per eliminare un evento
  app.delete('/api/alive/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({ error: 'ID evento non valido' });
      }

      // Prima recupera l'evento per avere i dettagli
      const eventResult = await pool.query(
        'SELECT * FROM alive_logs WHERE id = $1',
        [id]
      );

      if (eventResult.rows.length === 0) {
        return res.status(404).json({ error: 'Evento non trovato' });
      }

      // Elimina l'evento - il trigger PostgreSQL invierà la notifica
      await pool.query('DELETE FROM alive_logs WHERE id = $1', [id]);

      console.log('Evento eliminato:', eventResult.rows[0]);

      // Il trigger PostgreSQL gestirà automaticamente la notifica LISTEN/NOTIFY

      res.status(200).json({ message: 'Evento eliminato con successo', deletedEvent: eventResult.rows[0] });
    } catch (error) {
      console.error('Errore nell\'eliminazione dell\'evento:', error);
      res.status(500).json({ error: 'Errore interno del server' });
    }
  });
}

// Gestione delle connessioni WebSocket
io.on('connection', (socket) => {
  console.log('Nuovo client connesso:', socket.id);
  connectedClients.add(socket.id);
  socket.on('join-code', async (code: string) => {
    try {
      console.log(`Client ${socket.id} si è unito al codice: ${code}`);
      // Se il client era già associato a un altro codice, rimuovilo prima
      const previousCode = codeByClient.get(socket.id);
      if (previousCode && previousCode !== code) {
        console.log(`Client ${socket.id} stava monitorando il codice ${previousCode}, lo rimuovo`);
        socket.leave(previousCode);

        const previousClients = clientsByCode.get(previousCode);
        if (previousClients) {
          previousClients.delete(socket.id);
          if (previousClients.size === 0) {
            clientsByCode.delete(previousCode);
            console.log(`Codice ${previousCode} rimosso dalla mappa (nessun client connesso)`);
          }
        }
      }
      // Aggiungi il socket al gruppo del codice
      socket.join(code);
      // Traccia il codice per questo client (indirezione inversa)
      codeByClient.set(socket.id, code);
      // Traccia i client per codice (evita duplicati grazie alla Set)
      if (!clientsByCode.has(code)) {
        clientsByCode.set(code, new Set());
      }
      clientsByCode.get(code)!.add(socket.id);

      console.log(`Connessioni attive per il codice ${code}: ${clientsByCode.get(code)!.size}`);

      // Invia gli eventi storici
      const result = await pool.query(
        'SELECT * FROM alive_logs WHERE code = $1 ORDER BY created_at ASC',
        [code]
      );

      socket.emit('historical-events', result.rows);
      console.log(`Inviati ${result.rows.length} eventi storici al client ${socket.id}`);

    } catch (error) {
      console.error('Errore nel join del codice:', error);
      socket.emit('error', 'Errore nel recupero degli eventi');
    }
  });
  socket.on('disconnect', () => {
    console.log('Client disconnesso:', socket.id);
    connectedClients.delete(socket.id);
    // Utilizza la mappa inversa per trovare direttamente il codice del client
    const code = codeByClient.get(socket.id);
    if (code) {
      // Rimuovi il client dal codice
      const clients = clientsByCode.get(code);
      if (clients) {
        clients.delete(socket.id);
        console.log(`Rimosso client ${socket.id} dal codice ${code}. Connessioni rimanenti: ${clients.size}`);
        // Se non ci sono più connessioni per questo codice, pulisci
        if (clients.size === 0) {
          clientsByCode.delete(code);
          console.log(`Codice ${code} rimosso dalla mappa (nessun client connesso)`);
        }
      }
      // Rimuovi il client dalla mappa inversa
      codeByClient.delete(socket.id);
    }
  });
});

// Funzione per configurare il listener PostgreSQL globale
async function setupDatabaseListener() {
  if (notificationClient) {
    console.log('Listener PostgreSQL già attivo');
    return;
  }

  notificationClient = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'alive_logs_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
  });

  try {
    await notificationClient.connect();
    // Ascolta il canale globale per tutti i cambiamenti dei dati
    await notificationClient.query('LISTEN data_changes');
    notificationClient.on('notification', (msg) => {
      if (msg.channel === 'data_changes' && msg.payload) {
        try {
          const payload: NotificationPayload = JSON.parse(msg.payload);
          console.log('Notifica PostgreSQL ricevuta:', payload);

          // Invia l'evento a tutti i client connessi al codice specifico
          if (payload.table === 'alive_logs') {
            const event = payload.data;
            const code = payload.code;
            // Gestisce INSERT, UPDATE e DELETE
            switch (payload.action) {
              case 'INSERT':
                io.to(code).emit('new-event', event);
                console.log(`Nuovo evento inviato ai client del codice ${code} via LISTEN/NOTIFY`);
                break;
              case 'UPDATE':
                io.to(code).emit('updated-event', event);
                console.log(`Evento aggiornato inviato ai client del codice ${code} via LISTEN/NOTIFY`);
                break;
              case 'DELETE':
                io.to(code).emit('deleted-event', event);
                console.log(`Evento eliminato inviato ai client del codice ${code} via LISTEN/NOTIFY`);
                break;
            }
          }
        } catch (error) {
          console.error('Errore nel parsing del payload della notifica:', error);
        }
      }
    });

    notificationClient.on('error', (error) => {
      console.error('Errore nel client PostgreSQL LISTEN:', error);
      notificationClient = null;
    });

    console.log('Listener PostgreSQL configurato per data_changes');
  } catch (error) {
    console.error('Errore nella configurazione del listener PostgreSQL:', error);
    notificationClient = null;
  }
}

// Funzione per chiudere il listener PostgreSQL
async function closeDatabaseListener() {
  if (notificationClient) {
    try {
      await notificationClient.query('UNLISTEN data_changes');
      await notificationClient.end();
      notificationClient = null;
      console.log('Listener PostgreSQL chiuso');
    } catch (error) {
      console.error('Errore nella chiusura del listener PostgreSQL:', error);
    }
  }
}

// Avvio del server
const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
  console.log(`Server in esecuzione sulla porta ${PORT}`);
  await setupDatabaseListener();
});

// Gestione graceful shutdown
process.on('SIGINT', async () => {
  console.log('Chiusura del server...');
  await closeDatabaseListener();
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Chiusura del server...');
  await closeDatabaseListener();
  await pool.end();
  process.exit(0);
});
