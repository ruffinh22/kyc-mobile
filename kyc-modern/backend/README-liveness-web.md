# Face Liveness Web — déploiement et configuration

Ce document décrit la mise en place d'AWS Rekognition Face Liveness côté web.

## 1. Architecture

Le backend Fastify ne reçoit aucune vidéo de liveness.
Il expose uniquement :

- `POST /api/public/dossiers/:id/liveness-session`
  - Crée une session Rekognition liée au dossier.
- `GET /api/public/dossiers/:id/liveness-session/:sessionId/result`
  - Récupère le résultat AWS et persiste en base.

Le client web chargé dans la WebView utilise :

- `FaceLivenessDetector` (@aws-amplify/ui-react-liveness)
- `sessionId` et `region` fournis par le backend
- les identifiants temporaires Cognito non authentifié

## 2. Cognito Identity Pool

Créer un identity pool Cognito :

- Nom : `kyc-liveness-unauth`
- Autoriser l'accès non authentifié : oui
- Ne pas créer de fournisseur d'identité externe

Cognito génère un rôle pour les utilisateurs anonymes, par exemple :
`Cognito_kycLivenessUnauthRole`.

## 3. Policy IAM minimale

Attacher au rôle anonymes uniquement :

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "rekognition:StartFaceLivenessSession",
      "Resource": "*"
    }
  ]
}
```

> Ne jamais donner `rekognition:*` ou des permissions de lecture / écriture
> trop larges à ce rôle.

## 4. Variables d'environnement côté web

Dans le projet web Vite, ajouter :

```env
VITE_AWS_REGION=eu-west-1
VITE_COGNITO_IDENTITY_POOL_ID=eu-west-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
VITE_API_BASE_URL=http://localhost:3001
```

Ces valeurs sont publiques et peuvent être servies côté client.

## 4a. Variable backend pour la redirection liveness

Le backend Fastify peut rediriger `/liveness-check?dossierId=...` vers le frontend web.
Ajoute dans `kyc-modern/backend/.env` ou `.env.example` :

```env
FRONTEND_URL=http://localhost:5173
```

Si `FRONTEND_URL` n'est pas défini, le backend renverra une page d'erreur explicite.

## 5. Dépendances frontend

Installer dans `kyc-modern/frontend` :

```bash
npm install @aws-amplify/ui-react-liveness @aws-amplify/ui-react aws-amplify react react-dom
```

## 6. Page Web intégrée

Le composant `FaceLivenessCheck.tsx` est chargé sur la route :

- `/liveness-check?dossierId=...`

Il effectue :

1. `POST /api/public/dossiers/:id/liveness-session`
2. `FaceLivenessDetector sessionId region`
3. `GET /api/public/dossiers/:id/liveness-session/:sessionId/result`
4. `window.ReactNativeWebView.postMessage(...)`

## 7. Notes de sécurité

- Le `sessionId` est créé côté serveur et lié au dossier.
- Le client reçoit seulement un `sessionId` à usage unique.
- Le rôle Cognito non authentifié ne peut lancer qu'une session.
- Le backend vérifie que la session correspond bien au dossier avant de
  récupérer le résultat.
