const express = require('express');
const path = require('path');
const sqlite3 = require("sqlite3");
const db = new sqlite3.Database('database.db');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { setTimeout } = require('timers/promises');

const app = express();
const PORT = 80;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
	secret: 'your-secret-key',
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






function getSQL(request, ...args) {
	return new Promise((resolve, reject) => {
		db.get(request, args, (err, row) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(row);
		});
	});
}

function runSQL(request, ...args) {
	return new Promise((resolve, reject) => {
		db.run(request, args, function(err) {
			if (err) {
				reject(err);
				return;
			}
			resolve(this.changes);
		});
	});
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
			'INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)',
			id, name, email, hash
		);
		req.session.userId = id;
		req.session.userName = name;

		res.sendStatus(200);
	} catch (err) {
		console.error(err);
		if (err && err.code === 'SQLITE_CONSTRAINT') {
			if (err.message.includes('UNIQUE constraint failed: users.id')) {
				return res.status(400).send('ID already exists');
			}
			if (err.message.includes('UNIQUE constraint failed: users.email')) {
				return res.status(400).send('Email already exists');
			}
		}
		return res.status(500).send('Database error');
	}
});


app.post('/login', async (req, res) => {
	const { identifier, password } = req.body;
	try {
		const user = await getSQL('SELECT * FROM users WHERE email = ? OR id = ?', identifier, identifier);
		if (!user) {
			return res.status(401).send('Invalid credentials');
		}
		const match = await bcrypt.compare(password, user.password);
		if (!match) {
			return res.status(401).send('Invalid credentials');
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
		const existing = await getSQL('SELECT * FROM feeds WHERE id = ?', id);
		if (existing) {
			res.status(400).send('id already exists');
			return;
		}

		const now = Date.now();

		await runSQL(
			'INSERT INTO feeds (id, name, creationDate, ownerId) VALUES (?, ?, ?, ?)',
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
		'SELECT id FROM releases WHERE feedId = ? AND releaseDate = 0 ORDER BY day DESC LIMIT 1',
		feedId
	);
	if (!release) {
		// Si aucune release ouverte, on en crée une nouvelle (cas rare)
		const last = await getSQL('SELECT MAX(day) as maxDay FROM releases WHERE feedId = ?', feedId);
		const newDay = last && last.maxDay !== null ? last.maxDay + 1 : 0;
		await runSQL(
			'INSERT INTO releases (feedId, day, releaseDate, isEmpty) VALUES (?, ?, 0, 1)',
			feedId,
			newDay
		);
		release = await getSQL(
			'SELECT id FROM releases WHERE feedId = ? AND day = ?',
			feedId, newDay
		);
	}
	await runSQL(
		`INSERT INTO messages (releaseId, userId, content, createdAt) VALUES (?, ?, ?, ?)`,
		release.id,
		userId,
		content,
		time
	);
	await runSQL('UPDATE releases SET isEmpty = 0 WHERE id = ?', release.id);
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
    const releases = await new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM releases WHERE feedId = ? ORDER BY day DESC LIMIT ? OFFSET ?',
        [feedId, limit, offset],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    // Pour chaque release, récupère les messages
    await Promise.all(releases.map(async (release) => {
      const messages = await new Promise((resolve, reject) => {
        db.all(
          'SELECT id, content, createdAt, userId FROM messages WHERE releaseId = ? AND validated ORDER BY createdAt ASC',
          [release.id],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });

      // Pour chaque message, récupère les commentaires en parallèle
      await Promise.all(messages.map(async (msg) => {
        msg.comments = await new Promise((resolve, reject) => {
          db.all(
            `SELECT c.id, c.userId, u.name, c.content, c.createdAt
             FROM comments c
             JOIN users u ON c.userId = u.id
             WHERE c.messageId = ?
             ORDER BY c.createdAt ASC`,
            [msg.id],
            (err, rows) => {
              if (err) reject(err);
              else resolve(rows);
            }
          );
        });
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
		const feed = await getSQL('SELECT creationDate FROM feeds WHERE id = ?', feedId);
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
		const feed = await getSQL('SELECT id, name FROM feeds WHERE id = ?', feedId);
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
		const messages = await new Promise((resolve, reject) => {
			db.all(
				`SELECT m.id, m.userId, m.content, m.createdAt, m.validated
				 FROM messages m
				 JOIN releases r ON m.releaseId = r.id
				 WHERE r.feedId = ?
				 ORDER BY m.createdAt DESC`,
				[feedId],
				(err, rows) => {
					if (err) reject(err);
					else resolve(rows);
				}
			);
		});

		
		res.json(messages);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// API: valider/dévalider un message
app.post('/auth/api/message/:msgId/validate', async (req, res) => {
	const msgId = req.params.msgId;
	const { validated } = req.body;
	try {
		const rel = await getSQL('SELECT r.releaseDate FROM releases r JOIN messages m ON m.releaseId = r.id WHERE m.id = ?', msgId);
		if (rel && rel.releaseDate && rel.releaseDate > 0) return res.status(403).json({ error: 'Cannot modify a released message' });
		await runSQL('UPDATE messages SET validated = ? WHERE id = ?', validated ? 1 : 0, msgId);
		res.sendStatus(200);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// API: supprimer un message
app.delete('/auth/api/message/:msgId/delete', async (req, res) => {
	const msgId = req.params.msgId;
	try {
		const rel = await getSQL('SELECT r.releaseDate FROM releases r JOIN messages m ON m.releaseId = r.id WHERE m.id = ?', msgId);
		if (rel && rel.releaseDate && rel.releaseDate > 0) return res.status(403).json({ error: 'Cannot delete a released message' });
		await runSQL('DELETE FROM messages WHERE id = ?', msgId);
		res.sendStatus(200);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

app.get('/api/getFeedName/:feedId', async (req, res) => {
	const feedId = req.params.feedId;
	try {
		const name = await getSQL(`SELECT name FROM feeds WHERE id=?`, feedId);
		res.json(name);
	} catch (err) {
		res.status(400).json({ error: err.message });
	}

});

// API pour obtenir le day max d'un feed
app.get('/api/feed/:feedId/maxDay', async (req, res) => {
	const feedId = req.params.feedId;
	try {
		const row = await getSQL('SELECT MAX(day) as maxDay FROM releases WHERE feedId = ?', feedId);
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
		await runSQL('INSERT INTO releases (feedId, day, releaseDate) VALUES (?, ?, 0)', feedId, day);
		res.sendStatus(200);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// API pour "releaser" la release la plus récente et en créer une nouvelle
app.post('/api/feed/:feedId/release/latest', async (req, res) => {
	const feedId = req.params.feedId;
	try {
		// Récupère la release la plus récente
		const latest = await getSQL('SELECT id, day, isEmpty FROM releases WHERE feedId = ? AND releaseDate = 0 ORDER BY day DESC LIMIT 1', feedId);
		if (!latest) return res.status(404).json({ error: 'No release found' });
		if (latest.isEmpty) return res.status(400).json({ error: 'Cannot release an empty release' });
		// Vérifie que tous les messages sont validés
		const notValidated = await getSQL('SELECT COUNT(*) as nb FROM messages WHERE releaseId = ? AND validated = 0', latest.id);
		if (notValidated.nb > 0) return res.status(400).json({ error: 'All messages must be validated' });
		// Met à jour releaseDate
		await runSQL('UPDATE releases SET releaseDate = ? WHERE id = ?', Date.now(), latest.id);
		// Crée une nouvelle release (day+1, releaseDate=0, isEmpty=1)
		await runSQL('INSERT INTO releases (feedId, day, releaseDate, isEmpty) VALUES (?, ?, 0, 1)', feedId, latest.day + 1);
		// Met à jour msgCount
		const msgCountRow = await getSQL('SELECT COUNT(m.id) as count FROM messages m JOIN releases r ON m.releaseId = r.id WHERE r.feedId = ? AND m.validated = 1', feedId);
		await runSQL('UPDATE feeds SET msgCount = ? WHERE id = ?', msgCountRow.count, feedId);
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
		const rel = await getSQL('SELECT * FROM releases WHERE feedId = ? AND releaseDate = 0 ORDER BY day DESC LIMIT 1', feedId);
		if (!rel) return res.json({});
		// Récupère les messages
		rel.messages = await new Promise((resolve, reject) => {
			db.all(
				'SELECT * FROM messages WHERE releaseId = ? ORDER BY createdAt ASC',
				[rel.id],
				(err, rows) => {
					if (err) reject(err);
					else resolve(rows);
				}
			);
		});
		rel.isEmpty = rel.isEmpty === 1 || rel.isEmpty === true;
		res.json(rel);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// API pour les 20 messages les plus récents (tous feeds)
app.get('/api/messages/recent', async (req, res) => {
	try {
		const messages = await new Promise((resolve, reject) => {
			db.all(
				`SELECT m.*, r.feedId FROM messages m JOIN releases r ON m.releaseId = r.id ORDER BY m.createdAt DESC LIMIT 20`,
				[],
				(err, rows) => {
					if (err) reject(err);
					else resolve(rows);
				}
			);
		});
		res.json(messages);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// API: obtenir la liste des feeds suivis par l'utilisateur connecté
app.get('/auth/api/followedFeeds', async (req, res) => {
	try {
		const feeds = await new Promise((resolve, reject) => {
			db.all(
				`SELECT feeds.* FROM feeds JOIN userFeeds ON feeds.id = userFeeds.feedId WHERE userFeeds.userId = ?`,
				[req.session.userId],
				(err, rows) => {
					if (err) reject(err);
					else resolve(rows);
				}
			);
		});
		res.json(feeds);
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
			`INSERT OR IGNORE INTO userFeeds (userId, feedId) VALUES (?, ?)`,
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
			`DELETE FROM userFeeds WHERE userId = ? AND feedId = ?`,
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
        const feeds = await new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM feeds',
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
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
            'INSERT INTO comments (messageId, userId, content, createdAt) VALUES (?, ?, ?, ?)',
            msgId, userId, content, createdAt
        );
        res.sendStatus(200);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});







// Start server
app.listen(PORT, () => {
	console.log(`Server running on http://localhost:${PORT}`);
});

const FEED_BEST_NUM = 50;
let popularFeedsCache = [];
let recentFeedsCache = [];

async function refreshPopularFeeds() {
	const feeds = await new Promise((resolve, reject) => {
		db.all(`SELECT * FROM feeds ORDER BY msgCount DESC, creationDate DESC LIMIT ?`, [FEED_BEST_NUM], (err, rows) => {
			if (err) reject(err);
			else resolve(rows);
		});
	});
	popularFeedsCache = feeds;
}

async function refreshRecentFeeds() {
	const feeds = await new Promise((resolve, reject) => {
		db.all(`SELECT * FROM feeds ORDER BY creationDate DESC LIMIT ?`, [FEED_BEST_NUM], (err, rows) => {
			if (err) reject(err);
			else resolve(rows);
		});
	});
	recentFeedsCache = feeds;
}

// Initialisation au lancement du serveur
refreshPopularFeeds();
refreshRecentFeeds();

