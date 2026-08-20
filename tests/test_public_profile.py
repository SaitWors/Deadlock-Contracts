from __future__ import annotations

import uuid
import unittest

from fastapi.testclient import TestClient

from app.main import app


class PublicProfileTests(unittest.TestCase):
    def test_public_profile_publish_and_safe_social_links(self) -> None:
        slug = f"demo-{uuid.uuid4().hex[:10]}"
        with TestClient(app) as client:
            self.assertEqual(client.post('/api/auth/demo').status_code, 200)
            me = client.get('/api/me').json()
            headers = {'X-CSRF-Token': me['csrf_token']}

            initial = client.get('/api/profile/public')
            self.assertEqual(initial.status_code, 200)
            self.assertIn('suggested_slug', initial.json())

            saved = client.put('/api/profile/public', headers=headers, json={
                'slug': slug,
                'headline': 'Support main · Contract runner',
                'bio': 'A concise public dossier used for the profile regression test.',
                'theme': 'DOSSIER',
                'is_public': True,
                'show_stats': True,
                'show_showcase': True,
                'show_links': True,
                'links': {'twitch': 'https://twitch.tv/example'},
            })
            self.assertEqual(saved.status_code, 200)
            self.assertEqual(saved.json()['profile']['slug'], slug)
            self.assertEqual(saved.json()['profile']['links']['twitch'], 'https://twitch.tv/example')

            public = client.get(f'/api/public/profiles/{slug}')
            self.assertEqual(public.status_code, 200)
            payload = public.json()['profile']
            self.assertEqual(payload['slug'], slug)
            self.assertTrue(payload['is_public'])
            self.assertIn('player', payload)
            self.assertNotIn('steam_id64', payload['player'])

    def test_profile_rejects_non_official_social_host_and_private_is_hidden(self) -> None:
        slug = f"private-{uuid.uuid4().hex[:8]}"
        with TestClient(app) as client:
            client.post('/api/auth/demo')
            me = client.get('/api/me').json()
            headers = {'X-CSRF-Token': me['csrf_token']}

            bad = client.put('/api/profile/public', headers=headers, json={
                'slug': slug,
                'headline': '',
                'bio': '',
                'theme': 'NOIR',
                'is_public': False,
                'show_stats': True,
                'show_showcase': True,
                'show_links': True,
                'links': {'twitch': 'https://evil.example/not-twitch'},
            })
            self.assertEqual(bad.status_code, 422)

            saved = client.put('/api/profile/public', headers=headers, json={
                'slug': slug,
                'headline': '',
                'bio': '',
                'theme': 'NOIR',
                'is_public': False,
                'show_stats': False,
                'show_showcase': False,
                'show_links': False,
                'links': {},
            })
            self.assertEqual(saved.status_code, 200)
            self.assertEqual(client.get(f'/api/public/profiles/{slug}').status_code, 404)

    def test_public_profile_hides_progression_details_when_stats_are_disabled(self) -> None:
        slug = f"quiet-{uuid.uuid4().hex[:10]}"
        with TestClient(app) as client:
            self.assertEqual(client.post('/api/auth/demo').status_code, 200)
            me = client.get('/api/me').json()
            headers = {'X-CSRF-Token': me['csrf_token']}

            saved = client.put('/api/profile/public', headers=headers, json={
                'slug': slug,
                'headline': 'Minimal public identity',
                'bio': '',
                'theme': 'SIGNAL',
                'is_public': True,
                'show_stats': False,
                'show_showcase': False,
                'show_links': False,
                'links': {},
            })
            self.assertEqual(saved.status_code, 200)

            public = client.get(f'/api/public/profiles/{slug}')
            self.assertEqual(public.status_code, 200)
            payload = public.json()['profile']
            self.assertIsNone(payload['stats'])
            self.assertEqual(payload['showcase'], [])
            self.assertEqual(payload['links'], {})
            self.assertIsNone(payload['player']['xp'])
            self.assertIsNone(payload['player']['joined_at'])
            self.assertNotIn('steam_id64', payload['player'])



if __name__ == '__main__':
    unittest.main()
