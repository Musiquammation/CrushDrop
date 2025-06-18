const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.db');

db.serialize(() => {
	db.run('PRAGMA foreign_keys = ON;');
	
	db.run(`
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			email TEXT UNIQUE NOT NULL,
			password TEXT NOT NULL
		);
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS feeds (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			creationDate INTEGER NOT NULL, -- ms since epoch (Date.now())
			ownerId TEXT NOT NULL,
			msgCount INTEGER NOT NULL DEFAULT 0,
			FOREIGN KEY (ownerId) REFERENCES users(id)
		);
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS releases (
			id INTEGER PRIMARY KEY,
			feedId TEXT NOT NULL,
			day INTEGER NOT NULL, -- 0 = day of creation, then +1
			releaseDate INTEGER NOT NULL DEFAULT 0, -- ms since epoch, 0 = pas encore release
			isEmpty BOOLEAN NOT NULL DEFAULT 1, -- true = vide, false = au moins un message
			FOREIGN KEY (feedId) REFERENCES feeds(id),
			UNIQUE(feedId, day)
		);
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY,
			releaseId INTEGER NOT NULL,
			userId TEXT NOT NULL,
			content TEXT NOT NULL,
			createdAt INTEGER NOT NULL, -- ms since epoch (Date.now())
			likes INTEGER DEFAULT 0,
			dislikes INTEGER DEFAULT 0,
			validated BOOLEAN NOT NULL DEFAULT FALSE,
			FOREIGN KEY (releaseId) REFERENCES releases(id),
			FOREIGN KEY (userId) REFERENCES users(id)
		);
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS userFeeds (
			userId TEXT NOT NULL,
			feedId TEXT NOT NULL,
			PRIMARY KEY (userId, feedId),
			FOREIGN KEY (userId) REFERENCES users(id),
			FOREIGN KEY (feedId) REFERENCES feeds(id)
		);
	`);

	db.run(`
		CREATE TABLE IF NOT EXISTS comments (
			id INTEGER PRIMARY KEY,
			messageId INTEGER NOT NULL,
			userId TEXT NOT NULL,
			content TEXT NOT NULL,
			createdAt INTEGER NOT NULL,
			FOREIGN KEY (messageId) REFERENCES messages(id),
			FOREIGN KEY (userId) REFERENCES users(id)
		);

	`);


	db.run(`CREATE INDEX IF NOT EXISTS messageIndex ON messages (releaseId, createdAt DESC);`);
	db.run(`CREATE INDEX IF NOT EXISTS releaseFeedDayIndex ON releases (feedId, day);`);
	db.run(`CREATE INDEX IF NOT EXISTS messageUserIndex ON messages (userId);`);
	db.run(`CREATE INDEX IF NOT EXISTS userFeedIndex ON userFeeds(feedId);`);
	db.run(`CREATE INDEX IF NOT EXISTS commentMessageIndex ON comments (messageId, createdAt DESC);`);


});

module.exports = db;
