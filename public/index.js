document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('previewContent');
    const res = await fetch('/api/messages/recent');
    if (!res.ok) {
        container.textContent = 'Unable to load messages.';
        return;
    }

    const messages = await res.json();
    // container.innerHTML = '';
    for (const msg of messages) {
        const div = document.createElement('div');
        div.textContent = msg.content;
        div.addEventListener('click', () => {
            window.location.href = `/app?feed=${encodeURIComponent(msg.feedId)}`;
        });
        container.appendChild(div);
    }
});