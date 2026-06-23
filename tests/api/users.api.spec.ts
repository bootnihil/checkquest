import { test, expect } from '@playwright/test';

test.describe('Users API', () => {
  test('TC-API-001: get user by ID returns expected user structure', async ({ request }) => {
    const response = await request.get('/users/1');

    expect(response.status()).toBe(200);

    const body = await response.json();

    expect(body).toHaveProperty('id', 1);
    expect(body).toHaveProperty('name');
    expect(body).toHaveProperty('email');
    expect(body.email).toContain('@');
  });

  test('TC-API-002: create post returns created status and echoes payload', async ({ request }) => {
    const payload = {
      title: 'Risk-based QA automation demo',
      body: 'Created by Playwright API test',
      userId: 1
    };

    const response = await request.post('/posts', {
      data: payload
    });

    expect(response.status()).toBe(201);

    const body = await response.json();

    expect(body).toMatchObject(payload);
    expect(body).toHaveProperty('id');
  });

  test('TC-API-003: invalid endpoint returns not found', async ({ request }) => {
    const response = await request.get('/this-endpoint-does-not-exist');

    expect(response.status()).toBe(404);
  });
});