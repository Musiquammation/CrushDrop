document.addEventListener('DOMContentLoaded', () => {
	const createFeedBtn = document.getElementById('createFeedBtn');
	const searchBar = document.getElementById('searchBar');
	const popularBtn = document.getElementById('popularBtn');
	const recentBtn = document.getElementById('recentBtn');
	const followedFeedsDiv = document.getElementById('followedFeeds');
	const otherFeedsDiv = document.getElementById('otherFeeds');
	const otherFeedsTitle = document.getElementById('otherFeedsTitle');

	let mode = 'popular';
	let allFeeds = [];
	let followedFeeds = [];
	let searchTimeout = null;
	let lastSearchController = null;

	createFeedBtn.onclick = () => {
		window.location.href = "/createFeed";
	};

	async function fetchFeeds() {
		// Get followed feeds
		const followedRes = await fetch('/auth/api/followedFeeds');
		if (followedRes.ok) {
			followedFeeds = (await followedRes.json()) || [];
		} else {
			followedFeeds = [];
		}
		
		// Get other feeds (popular or recent)
		let url = mode === 'popular' ? '/api/feeds/popular' : '/api/feeds/recent';
		const otherRes = await fetch(url);
		allFeeds = (await otherRes.json()) || [];
		renderFeeds();
	}

	function renderFeeds() {
		// Filter by search
		const search = searchBar.value.trim().toLowerCase();
		// Followed feeds
		followedFeedsDiv.innerHTML = '';
		followedFeeds.filter(f => f.name.toLowerCase().includes(search)).forEach(feed => {
			const div = document.createElement('div');
			div.className = 'feed-item followed';
			div.textContent = feed.name;
			div.addEventListener('click', () => {
				window.location.href = `/app?feed=${feed.id}`;
			});
			followedFeedsDiv.appendChild(div);
		});
		// Other feeds
		otherFeedsDiv.innerHTML = '';
		allFeeds.filter(f => f.name.toLowerCase().includes(search) && !followedFeeds.some(ff => ff.id === f.id)).forEach(feed => {
			const div = document.createElement('div');
			div.className = 'feed-item';
			div.textContent = feed.name;
			div.addEventListener('click', () => {
				window.location.href = `/app?feed=${feed.id}`;
			});
			otherFeedsDiv.appendChild(div);
		});
		otherFeedsTitle.textContent = mode === 'popular' ? 'Most Popular Feeds' : 'Most Recent Feeds';
	}

	async function fetchAllFeeds(search) {
		if (lastSearchController) lastSearchController.abort();
		lastSearchController = new AbortController();
		const signal = lastSearchController.signal;
		try {
			const res = await fetch(`/api/feeds/all?search=${encodeURIComponent(search)}`, { signal });
			if (!res.ok) return [];
			return await res.json();
		} catch (e) {
			if (e.name === 'AbortError') return [];
			return [];
		}
	}

	searchBar.addEventListener('input', async () => {
		const search = searchBar.value.trim();
		if (search.length === 0) {
			mode = 'popular';
			popularBtn.classList.add('active');
			recentBtn.classList.remove('active');
			await fetchFeeds();
			return;
		}
		mode = 'all';
		popularBtn.classList.remove('active');
		recentBtn.classList.remove('active');
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(async () => {
			const [feeds, followedRes] = await Promise.all([
				fetchAllFeeds(search),
				fetch('/auth/api/followedFeeds').then(r => r.ok ? r.json() : [])
			]);
			allFeeds = feeds || [];
			followedFeeds = followedRes || [];
			renderFeeds();
		}, 200);
	});

	popularBtn.addEventListener('click', () => {
		mode = 'popular';
		popularBtn.classList.add('active');
		recentBtn.classList.remove('active');
		fetchFeeds();
	});
	recentBtn.addEventListener('click', () => {
		mode = 'recent';
		recentBtn.classList.add('active');
		popularBtn.classList.remove('active');
		fetchFeeds();
	});

	fetchFeeds();


});



async function createFeed(name, id) {
	try {
		const res = await fetch('/auth/createFeed', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, id })
		});
		if (res.ok) return null;
		const text = await res.text();
		return text;
	} catch (err) {
		return err.toString();
	}
}