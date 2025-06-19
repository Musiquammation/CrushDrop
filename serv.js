const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const app = express();


const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	ssl: { rejectUnauthorized: false },
});





app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
	secret: ';B[4r!N9s94Cyw',
	resave: false,
	saveUninitialized: true,
	cookie: { secure: false }
}));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/app', (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.get('/feedList', (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'feedList.html'));
})

app.get('/login', (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/signin', (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'signin.html'));
});

app.get('/createFeed', (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'createFeed.html'));
});

app.get('/auth/feedAdmin/:feedId', (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'feedAdmin.html'));
});





async function initDb() {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');

		await client.query(`
			CREATE TABLE IF NOT EXISTS crushDrop_users (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				email TEXT UNIQUE NOT NULL,
				password TEXT NOT NULL
			);
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS crushDrop_feeds (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				creationDate BIGINT NOT NULL,
				ownerId TEXT NOT NULL REFERENCES crushDrop_users(id),
				msgCount INTEGER NOT NULL DEFAULT 0
			);
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS crushDrop_releases (
				id SERIAL PRIMARY KEY,
				feedId TEXT NOT NULL REFERENCES crushDrop_feeds(id),
				day INTEGER NOT NULL,
				releaseDate BIGINT NOT NULL DEFAULT 0,
				isEmpty BOOLEAN NOT NULL DEFAULT TRUE,
				UNIQUE(feedId, day)
			);
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS crushDrop_messages (
				id SERIAL PRIMARY KEY,
				releaseId INTEGER NOT NULL REFERENCES crushDrop_releases(id),
				userId TEXT NOT NULL REFERENCES crushDrop_users(id),
				content TEXT NOT NULL,
				createdAt BIGINT NOT NULL,
				likes INTEGER DEFAULT 0,
				dislikes INTEGER DEFAULT 0,
				validated BOOLEAN NOT NULL DEFAULT FALSE
			);
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS crushDrop_userFeeds (
				userId TEXT NOT NULL REFERENCES crushDrop_users(id),
				feedId TEXT NOT NULL REFERENCES crushDrop_feeds(id),
				PRIMARY KEY (userId, feedId)
			);
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS crushDrop_comments (
				id SERIAL PRIMARY KEY,
				messageId INTEGER NOT NULL REFERENCES crushDrop_messages(id),
				userId TEXT NOT NULL REFERENCES crushDrop_users(id),
				content TEXT NOT NULL,
				createdAt BIGINT NOT NULL
			);
		`);

		// Indexes
		await client.query(`CREATE INDEX IF NOT EXISTS messageIndex ON crushDrop_messages (releaseId, createdAt DESC);`);
		await client.query(`CREATE INDEX IF NOT EXISTS releaseFeedDayIndex ON crushDrop_releases (feedId, day);`);
		await client.query(`CREATE INDEX IF NOT EXISTS messageUserIndex ON crushDrop_messages (userId);`);
		await client.query(`CREATE INDEX IF NOT EXISTS userFeedIndex ON crushDrop_userFeeds(feedId);`);
		await client.query(`CREATE INDEX IF NOT EXISTS commentMessageIndex ON crushDrop_comments (messageId, createdAt DESC);`);

		await client.query('COMMIT');
		console.log('PostgreSQL tables initialized.');
	} catch (err) {
		await client.query('ROLLBACK');
		console.error('Error during database init:', err);
	} finally {
		client.release();
	}
}





function getSQL(query, ...params) {
	return pool.query(query, params).then(res => res.rows[0]);
}

function runSQL(query, ...params) {
	return pool.query(query, params).then(res => res.rowCount);
}



app.post('/signin', async (req, res) => {
	const { id, name, email, password } = req.body;
	if (!id) {
		return res.status(400).send('ID is required');
	}
	if (!/^\w+$/.test(id)) {
		return res.status(400).send('ID must contain only letters, numbers, and underscores');
	}
	try {
		const hash = await bcrypt.hash(password, 10);
		await runSQL(
			'INSERT INTO crushDrop_users (id, name, email, password) VALUES ($1, $2, $3, $4)',
			id, name, email, hash
		);
		req.session.userId = id;
		req.session.userName = name;

		res.sendStatus(200);
	} catch (err) {
		console.error(err);
		if (err.code === '23505') { // PostgreSQL unique_violation
			if (err.detail.includes('(id)')) return res.status(400).send('ID already exists');
			if (err.detail.includes('(email)')) return res.status(400).send('Email already exists');
		}

		return res.status(500).send('Database error');
	}
});


app.post('/login', async (req, res) => {
	const { identifier, password } = req.body;
	try {
		const user = await getSQL('SELECT * FROM crushDrop_users WHERE email = $1 OR id = $2', identifier, identifier);
		if (!user) {
			return res.status(401).send('Invalid id');
		}
		const match = await bcrypt.compare(password, user.password);
		if (!match) {
			return res.status(401).send('Invalid password');
		}
		req.session.userId = user.id;
		req.session.userName = user.name;
		res.sendStatus(200);
	} catch (err) {
		return res.status(500).send('Database error');
	}
});

app.use('/auth', (req, res, next) => {
	if (!req.session.userId) {
		return res.status(401).send('Not authenticated');
	}
	next();
});


app.post('/auth/createFeed', async (req, res) => {
	const { name, id } = req.body;
	const ownerId = req.session.userId;
	if (!name || !id ) {
		res.status(400).send('Missing or invalid parameters');
		return;
	}

	try {
		const existing = await getSQL('SELECT * FROM crushDrop_feeds WHERE id = $1', id);
		if (existing) {
			res.status(400).send('id already exists');
			return;
		}

		const now = Date.now();

		await runSQL(
			'INSERT INTO crushDrop_feeds (id, name, creationDate, ownerId) VALUES ($1, $2, $3, $4)',
			id, name, now, ownerId
		);
		// Ajout au cache des feeds récents
		await refreshRecentFeeds();
		// Ajout au cache des feeds populaires si pas complet
		if (popularFeedsCache.length < FEED_BEST_NUM) {
			await refreshPopularFeeds();
		}
		res.sendStatus(200);

	} catch (err) {
		console.error(err);
		res.status(500).send('Database error');
	}
});


/**
 * Inserts a new message into the appropriate release of a feed based on the provided time.
 * 
 * - Calculates the day offset since the feed's creation date (in ms)
 * - Finds or creates the corresponding release for that day.
 * - Inserts the message linked to the release and the user.
 * 
 * @param {string} content - The text content of the message.
 * @param {string} userId - The ID of the user posting the message.
 * @param {string} feedId - The ID of the feed where the message belongs.
 * @param {number} time - The message creation time in minutes since Unix epoch (1970-01-01 00:00 UTC).
 * @returns {string} The unique ID of the newly created message.
 * @throws Will throw an error if the feed does not exist or if the time is before the feed's creation date.
 */
async function pushMessage(content, userId, feedId, time) {
	// On insère toujours dans la release ouverte (releaseDate = 0)
	let release = await getSQL(
		'SELECT id FROM crushDrop_releases WHERE feedId = $1 AND releaseDate = 0 ORDER BY day DESC LIMIT 1',
		feedId
	);
	if (!release) {
		// Si aucune release ouverte, on en crée une nouvelle (cas rare)
		const last = await getSQL('SELECT MAX(day) as maxDay FROM crushDrop_releases WHERE feedId = $1', feedId);
		const newDay = last && typeof last.maxDay === 'number' && !isNaN(last.maxDay)
			? last.maxDay + 1
			: 0;

		await runSQL(
			'INSERT INTO crushDrop_releases (feedId, day, releaseDate, isEmpty) VALUES ($1, $2, 0, TRUE)',
			feedId,
			newDay
		);
		release = await getSQL(
			'SELECT id FROM crushDrop_releases WHERE feedId = $1 AND day = $2',
			feedId, newDay
		);
	}
	await runSQL(
		`INSERT INTO crushDrop_messages (releaseId, userId, content, createdAt) VALUES ($1, $2, $3, $4)`,
		release.id,
		userId,
		content,
		time
	);
	await runSQL('UPDATE crushDrop_releases SET isEmpty = FALSE WHERE id = $1', release.id);
}



app.post('/auth/sendMsg', async (req, res) => {
	const { feedId, content } = req.body;
	const userId = req.session.userId;
	if (!userId) return res.status(401).send('Not authenticated');
	if (!feedId || !content) return res.status(400).send('Missing parameters');

	try {
		const time = Date.now();
		await pushMessage(content, userId, feedId, time);
		res.sendStatus(200);
	} catch (err) {
		console.error(err);
		res.status(500).send('Database error');
	}
});

// API pour récupérer les releases d'un feed avec pagination
app.get('/api/feed/:feedId/releases', async (req, res) => {
  const feedId = req.params.feedId;
  const offset = parseInt(req.query.offset) || 0;
  const limit = parseInt(req.query.limit) || 10;

  try {
    // Récupère les releases
    const releasesResult = await pool.query(
      'SELECT * FROM crushDrop_releases WHERE feedId = $1 ORDER BY day DESC LIMIT $2 OFFSET $3',
      [feedId, limit, offset]
    );
    const releases = releasesResult.rows;

    // Pour chaque release, récupère les messages
    await Promise.all(releases.map(async (release) => {
      const messagesResult = await pool.query(
        'SELECT id, content, createdAt, userId FROM crushDrop_messages WHERE releaseId = $1 AND validated ORDER BY createdAt ASC',
        [release.id]
      );
      const messages = messagesResult.rows;

      // Pour chaque message, récupère les commentaires en parallèle
      await Promise.all(messages.map(async (msg) => {
        const commentsResult = await pool.query(
          `SELECT c.id, c.userId, u.name, c.content, c.createdAt
           FROM crushDrop_comments c
           JOIN crushDrop_users u ON c.userId = u.id
           WHERE c.messageId = $1
           ORDER BY c.createdAt ASC`,
          [msg.id]
        );
        msg.comments = commentsResult.rows;
      }));

      release.messages = messages;
    }));

    res.json(releases);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// API pour récupérer la date de création d'un feed
app.get('/api/feed/:feedId/creationDate', async (req, res) => {
	const feedId = req.params.feedId;
	try {
		const feed = await getSQL('SELECT creationDate FROM crushDrop_feeds WHERE id = $1', feedId);
		if (!feed) return res.status(404).json({ error: 'Feed not found' });
		res.json({ creationDate: feed.creationDate });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// API: infos du feed
app.get('/auth/api/feed/:feedId/info', async (req, res) => {
	const feedId = req.params.feedId;
	try {
		const feed = await getSQL('SELECT id, name FROM crushDrop_feeds WHERE id = $1', feedId);
		if (!feed) return res.status(404).json({ error: 'Feed not found' });
		res.json(feed);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// API: liste des messages du feed (avec validation)
app.get('/auth/api/feed/:feedId/messages', async (req, res) => {
	const feedId = req.params.feedId;
	try {
		const messagesResult = await pool.query(
			`SELECT m.id, m.userId, m.content, m.createdAt, m.validated
			 FROM crushDrop_messages m
			 JOIN crushDrop_releases r ON m.releaseId = r.id
			 WHERE r.feedId = $1
			 ORDER BY m.createdAt DESC`,
			[feedId]
		);
		res.json(messagesResult.rows);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// API: valider/dévalider un message
app.post('/auth/api/message/:msgId/validate', async (req, res) => {
	const msgId = req.params.msgId;
	const { validated } = req.body;
	try {
		const rel = await getSQL('SELECT r.releaseDate FROM crushDrop_releases r JOIN crushDrop_messages m ON m.releaseId = r.id WHERE m.id = $1', msgId);
		if (rel && rel.releaseDate && rel.releaseDate > 0) return res.status(403).json({ error: 'Cannot modify a released message' });
		await runSQL('UPDATE crushDrop_messages SET validated = $1 WHERE id = $2', validated ? true : false, msgId);
		res.sendStatus(200);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// API: supprimer un message
app.delete('/auth/api/message/:msgId/delete', async (req, res) => {
	const msgId = req.params.msgId;
	try {
		const rel = await getSQL('SELECT r.releaseDate FROM crushDrop_releases r JOIN crushDrop_messages m ON m.releaseId = r.id WHERE m.id = $1', msgId);
		if (rel && rel.releaseDate && rel.releaseDate > 0) return res.status(403).json({ error: 'Cannot delete a released message' });
		await runSQL('DELETE FROM crushDrop_messages WHERE id = $1', msgId);
		res.sendStatus(200);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

app.get('/api/getFeedName/:feedId', async (req, res) => {
	const feedId = req.params.feedId;
	try {
		const name = await getSQL(`SELECT name FROM crushDrop_feeds WHERE id=$1`, feedId);
		res.json(name);
	} catch (err) {
		res.status(400).json({ error: err.message });
	}

});

// API pour obtenir le day max d'un feed
app.get('/api/feed/:feedId/maxDay', async (req, res) => {
	const feedId = req.params.feedId;
	try {
		const row = await getSQL('SELECT MAX(day) as maxDay FROM crushDrop_releases WHERE feedId = $1', feedId);
		res.json({ maxDay: row && row.maxDay !== null ? row.maxDay : -1 });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// API pour créer une nouvelle release (day = max+1)
app.post('/api/feed/:feedId/release', async (req, res) => {
	const feedId = req.params.feedId;
	const { day } = req.body;
	try {
		await runSQL('INSERT INTO crushDrop_releases (feedId, day, releaseDate) VALUES ($1, $2, 0)', feedId, day);
		res.sendStatus(200);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// API pour "releaser" la release la plus récente et en créer une nouvelle
app.post('/api/feed/:feedId/release/latest', async (req, res) => {
	const feedId = req.params.feedId;
	try {
		// Récupère la release la plus récente non vide
		const latest = await getSQL('SELECT id, day, isEmpty FROM crushDrop_releases WHERE feedId = $1 AND releaseDate = 0 AND isEmpty = FALSE ORDER BY day DESC LIMIT 1', feedId);
		if (!latest) return res.status(404).json({ error: 'No release found' });
		if (latest.isEmpty) return res.status(400).json({ error: 'Cannot release an empty release' });
		// Vérifie que tous les messages sont validés
		const notValidated = await getSQL('SELECT COUNT(*) as nb FROM crushDrop_messages WHERE releaseId = $1 AND validated = FALSE', latest.id);
		if (notValidated.nb > 0) return res.status(400).json({ error: 'All messages must be validated' });
		// Met à jour releaseDate
		await runSQL('UPDATE crushDrop_releases SET releaseDate = $1 WHERE id = $2', Date.now(), latest.id);
		// Crée une nouvelle release (day+1, releaseDate=0, isEmpty=1)
		await runSQL('INSERT INTO crushDrop_releases (feedId, day, releaseDate, isEmpty) VALUES ($1, $2, 0, TRUE)', feedId, latest.day + 1);
		// Met à jour msgCount
		const msgCountRow = await getSQL('SELECT COUNT(m.id) as count FROM crushDrop_messages m JOIN crushDrop_releases r ON m.releaseId = r.id WHERE r.feedId = $1 AND m.validated = TRUE', feedId);
		await runSQL('UPDATE crushDrop_feeds SET msgCount = $1 WHERE id = $2', msgCountRow.count, feedId);
		// Rafraîchit les caches
		await refreshPopularFeeds();
		await refreshRecentFeeds();
		res.sendStatus(200);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// API pour la dernière release non release d'un feed (pour l'admin)
app.get('/auth/api/feed/:feedId/latestRelease', async (req, res) => {
	const feedId = req.params.feedId;
	try {
		// 1. Récupère le dernier release non publié pour ce feed
		const releaseResult = await pool.query(
			`SELECT * FROM crushDrop_releases WHERE feedId = $1 AND releaseDate = 0 ORDER BY day DESC LIMIT 1`,
			[feedId]
		);

		if (releaseResult.rowCount === 0) return res.json({});

		const rel = releaseResult.rows[0];

		// 2. Récupère les messages du release
		const messagesResult = await pool.query(
			`SELECT * FROM crushDrop_messages WHERE releaseId = $1 ORDER BY createdAt ASC`,
			[rel.id]
		);

		rel.messages = messagesResult.rows;
		rel.isEmpty = rel.isempty === true || rel.isempty === 1; // Postgres lowercase column

		res.json(rel);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});



// API pour les 20 messages les plus récents (tous feeds)
app.get('/api/messages/recent', async (req, res) => {
	try {
		const messagesResult = await pool.query(
			`SELECT m.*, r.feedId FROM crushDrop_messages m JOIN crushDrop_releases r ON m.releaseId = r.id ORDER BY m.createdAt DESC LIMIT 20`
		);
		res.json(messagesResult.rows);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// API: obtenir la liste des feeds suivis par l'utilisateur connecté
app.get('/auth/api/followedFeeds', async (req, res) => {
	try {
		const feedsResult = await pool.query(
			`SELECT crushDrop_feeds.* FROM crushDrop_feeds JOIN crushDrop_userFeeds ON crushDrop_feeds.id = crushDrop_userFeeds.feedId WHERE crushDrop_userFeeds.userId = $1`,
			[req.session.userId]
		);
		res.json(feedsResult.rows);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// API: ajouter un feed suivi
app.post('/auth/api/followFeed', async (req, res) => {
	const { feedId } = req.body;
	if (!feedId) return res.status(400).json({ error: 'Missing feedId' });
	try {
		await runSQL(
			'INSERT INTO crushDrop_userFeeds (userId, feedId) VALUES ($1, $2) ON CONFLICT DO NOTHING',
			req.session.userId, feedId
		);
		res.sendStatus(200);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// API: supprimer un feed des favoris
app.delete('/auth/api/unfollowFeed', async (req, res) => {
	const { feedId } = req.body;
	if (!feedId) return res.status(400).json({ error: 'Missing feedId' });
	try {
		await runSQL(
			'DELETE FROM crushDrop_userFeeds WHERE userId = $1 AND feedId = $2',
			req.session.userId, feedId
		);
		res.sendStatus(200);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// API: feeds les plus populaires (par nombre de messages validés)
app.get('/api/feeds/popular', (req, res) => {
	res.json(popularFeedsCache);
});

// API: feeds les plus récents
app.get('/api/feeds/recent', (req, res) => {
	res.json(recentFeedsCache);
});

// API: tous les feeds (pour la recherche)
app.get('/api/feeds/all', async (req, res) => {
    try {
        const search = (req.query.search || '').toLowerCase();
        const limit = Math.min(parseInt(req.query.limit) || 100, 200); // limite de sécurité
        const feedsResult = await pool.query('SELECT * FROM crushDrop_feeds');
        const feeds = feedsResult.rows;
        // Filtrage côté serveur si un terme de recherche est fourni
        const filtered = search ? feeds.filter(f => f.name.toLowerCase().includes(search) || f.id.toLowerCase().includes(search)) : feeds;
        res.json(filtered.slice(0, limit));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/auth/api/message/comment', async (req, res) => {
    const { content, msgId } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Empty comment' });
    try {
        const userId = req.session.userId;
        if (!userId) return res.status(401).json({ error: 'Not authenticated' });
        const createdAt = Date.now();
        await runSQL(
            'INSERT INTO crushDrop_comments (messageId, userId, content, createdAt) VALUES ($1, $2, $3, $4)',
            msgId, userId, content, createdAt
        );
        res.sendStatus(200);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});








const FEED_BEST_NUM = 50;
let popularFeedsCache = [];
let recentFeedsCache = [];

async function refreshPopularFeeds() {
	const feedsResult = await pool.query(`SELECT * FROM crushDrop_feeds ORDER BY msgCount DESC, creationDate DESC LIMIT $1`, [FEED_BEST_NUM]);
	popularFeedsCache = feedsResult.rows;
}

async function refreshRecentFeeds() {
	const feedsResult = await pool.query(`SELECT * FROM crushDrop_feeds ORDER BY creationDate DESC LIMIT $1`, [FEED_BEST_NUM]);
	recentFeedsCache = feedsResult.rows;
}

// Initialisation au lancement du serveur
(async () => {
	await initDb();
	await refreshPopularFeeds();
	await refreshRecentFeeds();
})();







const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Server listening on port ${PORT}`);
});

