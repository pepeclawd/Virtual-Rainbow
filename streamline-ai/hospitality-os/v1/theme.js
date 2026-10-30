// Applies the saved Dag/Aften theme before first paint (a display preference only; no guest data).
document.documentElement.dataset.theme = localStorage.getItem('hos-theme') === 'aften' ? 'aften' : 'dag';
