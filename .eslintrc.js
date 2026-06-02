module.exports = {
	root: true,
	env: { node: true, es2020: true },
	parser: '@typescript-eslint/parser',
	parserOptions: { project: ['tsconfig.json'], tsconfigRootDir: __dirname },
	plugins: ['@typescript-eslint'],
	extends: [
		'eslint:recommended',
		'plugin:@typescript-eslint/recommended',
	],
	rules: {
		'@typescript-eslint/no-explicit-any': 'warn',
		'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
		'no-console': 'off',
	},
	ignorePatterns: ['dist/', 'node_modules/', 'gulpfile.js', 'index.js'],
};
