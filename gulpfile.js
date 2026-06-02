const { src, dest } = require('gulp');
const path = require('path');

function buildIcons() {
	const nodeSource = path.resolve('nodes', '**', '*.svg');
	const nodeDest = path.join('dist', 'nodes');
	src(nodeSource).pipe(dest(nodeDest));

	const credSource = path.resolve('credentials', '**', '*.svg');
	const credDest = path.join('dist', 'credentials');
	return src(credSource).pipe(dest(credDest));
}

exports['build:icons'] = buildIcons;
