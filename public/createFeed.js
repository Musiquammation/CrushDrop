function normalizeId(str) {
	return str
		.normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
		.replace(/[^A-Za-z0-9 ]/g, '') // remove special characters
		.replace(/\s+/g, '_') // spaces to underscores
		.replace(/_+/g, '_') // multiple underscores to one
		.replace(/^_+|_+$/g, '') // no underscores at start/end
		.toLowerCase();
}

document.addEventListener('DOMContentLoaded', () => {
	const nameInput = document.getElementById('feedName');
	const idInput = document.getElementById('feedId');
	const form = document.getElementById('feedForm');
	const errorMsg = document.getElementById('errorMsg');
	const successMsg = document.getElementById('successMsg');

	
	nameInput.addEventListener('input', () => {
		const id = normalizeId(nameInput.value);
		idInput.value = id;
	});

	idInput.addEventListener('input', () => {
		idInput.value = normalizeId(idInput.value);
	});

	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		errorMsg.textContent = '';
		successMsg.textContent = '';
		const name = nameInput.value.trim();
		const id = idInput.value.trim();
		if (!name || !id) {
			errorMsg.textContent = 'Name and ID are required.';
			return;
		}
		if (!/^[A-Za-z0-9_]+$/.test(id)) {
			errorMsg.textContent = 'ID must only contain letters, numbers, or underscores.';
			return;
		}
		const err = await createFeed(name, id);
		if (err) {
			errorMsg.textContent = err;
		} else {
			window.location.href = `/app?feed=${encodeURIComponent(id)}`;
		}
	});
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
