
/**
 * Tests for the express implementation
 */

import express from 'express';
import { mock, supermock } from 'express-supermock';

import supertest from 'supertest';

import proxyquire from 'proxyquire';
import { assert } from 'chai';
import setCookieParser from 'set-cookie-parser';

import mockApi, { createToken } from './mock';

import cookieParser from 'cookie-parser';


// @ts-ignore
supermock['@global'] = true;

mock('mock-api.unolog.in', { router: mockApi });

const unologin = proxyquire('../src/main', { superagent: supermock });

const { 
  onAuthError,
  parseLogin,
  requireLogin,
  loginEventHandler, 
  logoutHandler,
} = proxyquire(
  '../src/unologin-express',
  {
    './main': unologin,
  },
);

const app = express();

const cookiesDomain = '.example.com';

// setup unologin
unologin.setup(
  {
    apiKey: 'abc123',
    cookiesDomain,
    realm: 
    {
      apiUrl: 'https://mock-api.unolog.in',
      frontendUrl: 'https://mock-frontend.unolog.in',
    },
  },
);

app.use(express.json());
app.use(cookieParser());

app.post('/unologin/login', loginEventHandler);

app.all('*', parseLogin);

app.all('/me/*', requireLogin);

app.post('/logout', logoutHandler);

app.all('*', (req, res) => 
{
  res.send({ user: res.locals.unologin?.user });
});

describe('loginEventHandler', () => 
{
  const user =
  {
    asuId: '5ebac35e9bdf9a2ebbb8e92f',
    userClasses: ['users_default'],
  };

  let cookies = [];

  it('redirects to the unologin front end with success=true', async () => 
  {
    const token = createToken(user);

    const { text, headers } = await supertest(app)
      .post(`/unologin/login?token=${token}`)
      // expect a redirect
      .expect(302);

    const url = new URL(text.replace('Found. Redirecting to ', ''));

    assert.strictEqual(url.hostname, 'mock-frontend.unolog.in');
    assert.strictEqual(url.searchParams.get('success'), 'true');

    const loginCookie = setCookieParser.parseString(headers['set-cookie'][0]);
    const statusCookie = setCookieParser.parseString(headers['set-cookie'][1]);

    assert.strictEqual(loginCookie.name, '_uno_appLoginToken');
    assert.strictEqual(loginCookie.httpOnly, true);
    assert.strictEqual(loginCookie.secure, true);
    assert.strictEqual(loginCookie.value, token);
    assert.strictEqual(loginCookie.domain, cookiesDomain);

    assert.strictEqual(statusCookie.name, '_uno_loginState');
    assert(!statusCookie.httpOnly);
    assert.strictEqual(statusCookie.secure, true);
    assert.strictEqual(statusCookie.value, 'success');
    assert.strictEqual(statusCookie.domain, cookiesDomain);

    cookies = headers['set-cookie'];
  });

  it('set-cookie results in valid login credentials', async () => 
  {
    const { text } = await supertest(app).post('/me/test')
      .set('Cookie', cookies)
      .send()
      .expect(200);

    assert.deepStrictEqual(JSON.parse(text).user, user);
  });

  it('redirects to the unologin front end with success=false', async () => 
  {
    const token = 'invalid';

    const { text, headers } = await supertest(app)
      .post(`/unologin/login?token=${token}`)
      // expect a redirect
      .expect(302);

    const url = new URL(text.replace('Found. Redirecting to ', ''));

    assert.strictEqual(url.hostname, 'mock-frontend.unolog.in');
    assert.strictEqual(url.searchParams.get('success'), 'false');
    assert.strictEqual(url.searchParams.get('msg'), 'invalid token');

    assert.strictEqual(headers['set-cookie'], undefined);
  });

});

describe('parseLogin', () => 
{

  it('does nothing when not providing any login cookie', async () => 
  {
    const res = await supertest(app).post('/public')
      .send()
      .expect(200);

    const { user } = JSON.parse(res.text);

    assert.strictEqual(user, undefined);

  });

  it('error code when using an invalid cookie where not required', async () => 
  {
    await supertest(app).post('/public')
      .set('Cookie', ['_uno_appLoginToken=invalid'])
      .send()
      .expect(401);

  });

  it('parses the login info if valid', async () => 
  {
    const res = await supertest(app).post('/public')
      .set('Cookie', [''])
      .send()
      .expect(200);

    const { user } = JSON.parse(res.text);

    assert.strictEqual(user, undefined);

  });

});

describe('requireLogin', () => 
{
  it('error code when missing cookie where required', async () => 
  {
    await supertest(app).post('/me/test')
      .send()
      .expect(401);

  });

  it('error code when using an invalid cookie where required', async () => 
  {
    await supertest(app).post('/me/test')
      .set('Cookie', ['_uno_appLoginToken=invalid'])
      .send()
      .expect(401);
  });

});

describe('custom error handlers', () => 
{
  it('executes the custom handler', async () => 
  {
    // register a custom handler
    onAuthError((req, res) =>
    {
      res.status(666);
      res.send('custom error');
    });

    await supertest(app).post('/me/test')
      .set('Cookie', ['_uno_appLoginToken=invalid'])
      .send()
      .expect(666);
  });

});

