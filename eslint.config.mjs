import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

const authoredTypeScriptFiles = [
  'agent/**/*.ts',
  'tests/**/*.ts',
  'pages/**/*.ts',
  'playwright.config.ts'
];

export default [
  {
    ignores: [
      'agent-results/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**'
    ]
  },
  {
    files: authoredTypeScriptFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir:
          import.meta.dirname
      }
    },
    plugins: {
      '@typescript-eslint':
        tseslint.plugin
    },
    rules: {
      ...eslint.configs.recommended.rules,
      ...tseslint.configs
        .eslintRecommended.rules,
      'no-constant-binary-expression':
        'error',
      'no-debugger':
        'error',
      'no-useless-catch':
        'error',
      eqeqeq: [
        'error',
        'always',
        {
          null:
            'ignore'
        }
      ],
      curly: [
        'error',
        'all'
      ],
      'prefer-const':
        'error',
      'prefer-rest-params':
        'off',
      'prefer-spread':
        'off',
      'no-console':
        'off',
      'no-fallthrough':
        'off',
      'no-undef':
        'off',
      'no-unused-labels':
        'off',
      'no-unused-private-class-members':
        'off',
      'no-unused-vars':
        'off',
      '@typescript-eslint/no-floating-promises':
        'error',
      '@typescript-eslint/no-misused-promises':
        'error',
      '@typescript-eslint/await-thenable':
        'error',
      '@typescript-eslint/no-explicit-any':
        'error',
      '@typescript-eslint/only-throw-error':
        'error',
      '@typescript-eslint/consistent-type-imports':
        'error'
    }
  }
];
