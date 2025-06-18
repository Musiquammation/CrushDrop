document.addEventListener('DOMContentLoaded', async () => {
	const feedId = getFeedIdFromUrl();
	if (!feedId) {
		document.getElementById('feedInfo').textContent = 'Feed ID not found in URL.';
		return;
	}
	document.getElementById('releaseBtn').addEventListener('click', async () => {
		if (await releaseLatest(feedId)) {
			await loadMessages(feedId);
		}
		
	});
	await loadFeedInfo(feedId);
	await loadMessages(feedId);
});

function getFeedIdFromUrl() {
	const match = window.location.pathname.match(/feedAdmin\/(.+)$/);
	return match ? match[1] : null;
}

function normalizeId(str) {
	return str
		.normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
		.replace(/[^A-Za-z0-9 ]/g, '') // remove special characters
		.replace(/\s+/g, '_') // spaces to underscores
		.replace(/_+/g, '_') // multiple underscores to one
		.replace(/^_+|_+$/g, '') // no underscores at start/end
		.toLowerCase();
}

async function loadFeedInfo(feedId) {
	const res = await fetch(`/auth/api/feed/${feedId}/info`);
	if (!res.ok) return;
	const info = await res.json();
	document.getElementById('feedTitle').innerHTML = `Feed: ${info.name}`;
}

async function loadMessages(feedId) {
	// Récupère la dernière release (non release) et ses messages
	const relRes = await fetch(`/auth/api/feed/${feedId}/latestRelease`);
	if (!relRes.ok) return;
	const latestRelease = await relRes.json();
	const container = document.getElementById('messagesContainer');
	container.innerHTML = '';
	if (!latestRelease || !latestRelease.id) {
		container.textContent = 'No release.';
		document.getElementById('releaseBtn').disabled = true;
		return;
	}
	// Affiche les messages de la release courante
	for (const msg of latestRelease.messages) {
		const div = document.createElement('div');
		div.className = 'admin-message';
		const dateStr = new Date(msg.createdAt).toLocaleString();
		div.innerHTML = `
			<b>${msg.userId}</b> <span>(${dateStr})</span><br>
			<span>${msg.content}</span><br>
			<button class="validate-btn" data-id="${msg.id}">${msg.validated ? 'Unvalidate' : 'Validate'}</button>
			<button class="delete-btn" data-id="${msg.id}">Delete</button>
		`;
		div.querySelector('.validate-btn').addEventListener('click', async (e) => {
			await validateMessage(msg.id, !msg.validated);
			await loadMessages(feedId); // refresh
		});
		div.querySelector('.delete-btn').addEventListener('click', async (e) => {
			await deleteMessage(msg.id);
			div.remove();
		});
		container.appendChild(div);
	}
	// Désactive le bouton release si la release est vide
	document.getElementById('releaseBtn').disabled = !!latestRelease.isEmpty;
}

async function validateMessage(msgId, validated) {
	await fetch(`/auth/api/message/${msgId}/validate`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ validated })
	});
}

async function deleteMessage(msgId) {
	await fetch(`/auth/api/message/${msgId}/delete`, {
		method: 'DELETE'
	});
}

async function releaseLatest(feedId) {
    const relRes = await fetch(`/auth/api/feed/${feedId}/latestRelease`);
    if (!relRes.ok) return;
    const latestRelease = await relRes.json();
    const notValidated = latestRelease.messages ? latestRelease.messages.map((m, i) => ({...m, idx: i})).filter(m => !m.validated) : [];
    const container = document.getElementById('messagesContainer');
    const list = container.querySelectorAll('.admin-message');

    [...list].forEach(div => {
        div.classList.remove('red');
    });

    notValidated.forEach(m => {
        const div = list[m.idx];
        console.log(div);
        if (div) div.classList.add('red');
    });

    if (notValidated.length > 0) {
        alert('All messages must be validated before releasing!');
        return false;
    }

    await fetch(`/api/feed/${feedId}/release/latest`, {
        method: 'POST'
    });

	return true;
}


