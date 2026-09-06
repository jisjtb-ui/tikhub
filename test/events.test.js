import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeUser, pickProfileImage, normalizeChat, normalizeLike } from '../src/events.js';

test('User から id / uniqueId / nickname を取り出す', () => {
  const user = normalizeUser({ id: 42, uniqueId: 'kawaii_fan', nickname: 'かわいい担当' });
  assert.equal(user.id, '42');
  assert.equal(user.uniqueId, 'kawaii_fan');
  assert.equal(user.nickname, 'かわいい担当');
});

test('User が無くても落ちない', () => {
  assert.deepEqual(normalizeUser(null),
    { id: null, uniqueId: 'unknown', nickname: 'unknown', profileImageUrl: null });
});

test('プロフィール画像は 100x100 の webp を優先する', () => {
  const url = pickProfileImage({
    avatarThumb: {
      urlList: [
        'https://p16.tiktokcdn.com/large~tplv-shrink.jpeg',
        'https://p16.tiktokcdn.com/100x100/pic.webp',
      ],
    },
  });
  assert.equal(url, 'https://p16.tiktokcdn.com/100x100/pic.webp');
});

test('avatarThumb が無ければ medium / large を見る', () => {
  const url = pickProfileImage({ avatarLarge: { urlList: ['https://p16.tiktokcdn.com/big.jpeg'] } });
  assert.equal(url, 'https://p16.tiktokcdn.com/big.jpeg');
});

test('簡易化済みの User は profilePictureUrl をそのまま使う', () => {
  assert.equal(pickProfileImage({ profilePictureUrl: 'https://p16.tiktokcdn.com/a.webp' }),
    'https://p16.tiktokcdn.com/a.webp');
});

test('画像が取れなければ null (表示側が既定アイコンにする)', () => {
  assert.equal(pickProfileImage({ uniqueId: 'nobody' }), null);
  assert.equal(pickProfileImage({ avatarThumb: { urlList: [] } }), null);
  assert.equal(normalizeUser({ uniqueId: 'nobody' }).profileImageUrl, null);
});

test('画像はイベントに付いて流れる', () => {
  const like = normalizeLike({
    user: { id: '1', uniqueId: 'fan', avatarThumb: { urlList: ['https://x/100x100/a.webp'] } },
    count: 3,
  });
  assert.equal(like.user.profileImageUrl, 'https://x/100x100/a.webp');
  assert.equal(like.count, 3);

  const chat = normalizeChat({ user: { uniqueId: 'fan' }, comment: 'hello' });
  assert.equal(chat.comment, 'hello');
  assert.equal(chat.user.profileImageUrl, null);
});
