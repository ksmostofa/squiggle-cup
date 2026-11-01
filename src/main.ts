const app = document.getElementById('app')!;

const title = document.createElement('h1');
title.textContent = 'Squiggle Cup';

const tagline = document.createElement('p');
tagline.textContent = 'Draw a creature. Race your friends.';

app.append(title, tagline);
