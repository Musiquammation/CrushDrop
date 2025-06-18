const feedId = (new URL(window.location.href)).searchParams.get('feed');

async function fetchReleases(feedId) {
	const res = await fetch(`/api/feed/${feedId}/releases?offset=0&limit=20`);
	if (!res.ok) return [];
	return await res.json();
}

function formatDay(date) {
	return date.toLocaleString('en-US', {
		weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
		hour: '2-digit', minute: '2-digit', second: '2-digit'
	});
}

async function sendMsg(content) {
	try {
		const res = await fetch('/auth/sendMsg', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ feedId, content })
		});
		if (res.ok) return null;
		const text = await res.text();
		return text;
	} catch (err) {
		return err.toString();
	}
}

async function isFeedFollowed() {
	const res = await fetch('/auth/api/followedFeeds');
	if (!res.ok) throw new Error("Not connected");
	const feeds = await res.json();
	return feeds.some(f => f.id === feedId);
}

async function followFeed() {
	await fetch('/auth/api/followFeed', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ feedId })
	});
}

async function unfollowFeed() {
	await fetch('/auth/api/unfollowFeed', {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ feedId })
	});
}

function renderFollowBtn(followed) {
	const container = document.getElementById('followBtnContainer');
	const btn = document.createElement('button');
	btn.textContent = followed ? 'Unfollow' : 'Follow';
	btn.addEventListener('click', async () => {
		if (btn.textContent === 'Follow') {
			await followFeed(feedId);
			btn.textContent = 'Unfollow';
		} else {
			await unfollowFeed(feedId);
			btn.textContent = 'Follow';
		}
	});
	container.appendChild(btn);
}


document.addEventListener('DOMContentLoaded', async () => {
	const feedTitle = document.getElementById("feedTitle");
	try {
		const response = await fetch(`/api/getFeedName/${encodeURIComponent(feedId)}`);

		if (!response.ok) {
			throw new Error(response.error);
		}

		const data = await response.json();
		feedTitle.innerText = data.name;
		

	} catch (error) {
		console.error(error);
	}

	const adminBtn = document.getElementById("adminBtn");

	const feedContainer = document.getElementById('feedContainer');
	if (!feedId) {
		feedContainer.textContent = 'No feed selected.';
		return;
	}

	let followedFeeds = [];
	let isConnected = false;
	try {
		const res = await fetch('/auth/api/followedFeeds');
		if (res.ok) {
			followedFeeds = await res.json(); 
			isConnected = true;
		}
	} catch (err) {
		console.error(err);
	}

	
	if (isConnected) {
		const followed = followedFeeds.some(f => f.id === feedId);
		renderFollowBtn(followed);

		adminBtn.classList.remove("hidden");
		adminBtn.addEventListener('click', () => {
			window.location.href = '/auth/feedAdmin/' + feedId;
		})
	}

	const inputMsg = document.getElementById('postMessageInput');
	const btnPost = document.getElementById('postMessageBtn');

	
	if (isConnected) {
		inputMsg.disabled = false;
		inputMsg.placeholder = 'Write a public message...';
		inputMsg.className = 'input-connected';
		btnPost.disabled = false;
	} else {
		inputMsg.disabled = true;
		inputMsg.placeholder = 'Connect to post a message...';
		inputMsg.className = 'input-disconnected';
		btnPost.disabled = true;
	}

	btnPost.addEventListener('click', async () => {
		const content = inputMsg.value.trim();
		if (!content) return alert('Message cannot be empty');
		const error = await sendMsg(content);
		if (error) {
			alert('Error posting message: ' + error);
		} else {
			inputMsg.value = '';
		}
	});

	inputMsg.addEventListener('keydown', async (e) => {
		if (e.key === 'Enter' && !btnPost.disabled) {
			e.preventDefault();
			btnPost.click();
		}
	});

	
	document.getElementById("shareBtn").addEventListener("click", () => {
		const shareUrl = `${window.location.origin}/app?feed=${feedId}`;

		if (navigator.share) {
			navigator.share({
			title: 'Check this feed!',
			url: shareUrl
			}).catch(console.error);
		} else {
			// fallback : copier dans le presse-papier
			navigator.clipboard.writeText(shareUrl)
			.then(() => alert('Lien copié dans le presse-papier'))
			.catch(e => {
				alert("An error occured.");
				console.error(e);
			});
		}
	});


	let releases = await fetchReleases(feedId);
	if (!releases.length) {
		feedContainer.textContent = 'No releases yet.';
		return;
	}

	releases = releases.filter(r => r.releaseDate && r.releaseDate > 0);
	releases.sort((a, b) => b.releaseDate - a.releaseDate);

	for (const release of releases) {
		const releaseDiv = document.createElement('div');
		releaseDiv.className = 'release prettyScrollbar';

		// Titre avec la date de la release
		const title = document.createElement('div');
		title.textContent = formatDay(new Date(release.releaseDate));
		releaseDiv.appendChild(title);

		// Parcourir tous les messages de la release
		for (const msg of release.messages) {
			// Container message + commentaires
			const messageBlock = document.createElement('div');
			messageBlock.className = 'message-block';

			// Contenu du message
			const messageContent = document.createElement('p');
			messageContent.textContent = msg.content;
			messageContent.className = 'message-content';
			messageBlock.appendChild(messageContent);

			// Liste des commentaires pour ce message
			const commentList = document.createElement('div');
			commentList.className = 'comment-list';

			function renderComments() {
				commentList.innerHTML = ''; // reset
				const comments = msg.comments || [];
				if (comments.length === 0) {
					commentList.innerHTML = '<i>No comments</i>';
				} else {
					for (const c of comments) {
						const cDiv = document.createElement('div');
						cDiv.className = 'comment';
						const date = new Date(c.createdAt);
						const dateStr = date.toLocaleString('fr-FR', {
							day: '2-digit', month: '2-digit', year: 'numeric',
							hour: '2-digit', minute: '2-digit', second: '2-digit'
						});
						cDiv.innerHTML = `<b>${c.name}</b> <span style="color:gray; font-size:0.9em;">[${dateStr}]</span> : <div>${c.content}</div>`;
						commentList.appendChild(cDiv);
					}
				}
			}
			renderComments();
			messageBlock.appendChild(commentList);

			// Formulaire ajout commentaire
			const commentFormDiv = document.createElement('div');
			commentFormDiv.className = 'comment-form';
			const input = document.createElement('input');
			input.type = 'text';

			if (isConnected) {
				input.placeholder = 'Add a comment...';
				input.disabled = false;
				input.className = 'input-connected';
			} else {
				input.placeholder = 'Connect you to write a comment...';
				input.disabled = true;
				input.className = 'input-disconnected';
			}

			input.addEventListener('keydown', async (e) => {
				if (e.key === 'Enter' && isConnected) {
					const content = input.value.trim();
					if (!content) return;
					const res = await fetch(`/auth/api/message/comment`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ content, msgId: msg.id })
					});
					if (res.ok) {
						input.value = '';
						// Rafraîchir les commentaires du message
						let newReleases = await fetchReleases(feedId);
						newReleases = newReleases.filter(r => r.releaseDate && r.releaseDate > 0);
						newReleases.sort((a, b) => b.releaseDate - a.releaseDate);
						const newRelease = newReleases.find(r => r.releaseDate === release.releaseDate);
						if (newRelease) {
							const newMsg = newRelease.messages.find(m => m.id === msg.id);
							if (newMsg) {
								msg.comments = newMsg.comments;
								renderComments();
							}
						}
					} else {
						alert('Please connect you to write a comment');
					}
				}
			});

			commentFormDiv.appendChild(input);
			messageBlock.appendChild(commentFormDiv);

			// Ajout du message complet à la release
			releaseDiv.appendChild(messageBlock);
		}

		feedContainer.appendChild(releaseDiv);
	}

});
