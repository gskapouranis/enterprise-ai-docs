import os
import jwt
from jwt import PyJWKClient
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer()

# Το Issuer URL από το Clerk
CLERK_ISSUER = os.getenv("CLERK_ISSUER_URL", "")

if CLERK_ISSUER:
    JWKS_URL = f"{CLERK_ISSUER.rstrip('/')}/.well-known/jwks.json"
    jwk_client = PyJWKClient(JWKS_URL)
else:
    jwk_client = None


def verify_clerk_token(credentials: HTTPAuthorizationCredentials = Security(security)) -> str:
    """
    Επαληθεύει το Clerk JWT token και επιστρέφει το αυθεντικοποιημένο user_id.
    """
    token = credentials.credentials

    if not jwk_client:
        raise HTTPException(
            status_code=500,
            detail="Το CLERK_ISSUER_URL δεν έχει ρυθμιστεί στο backend .env"
        )

    try:
        # Παίρνουμε το δημόσιο κλειδί υπογραφής από το Clerk
        signing_key = jwk_client.get_signing_key_from_jwt(token)
        
        # Αποκωδικοποιούμε και επαληθεύουμε το token
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            options={"verify_aud": False}
        )
        
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Άκυρο Token: Λείπει το user ID")
            
        return user_id

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Το token έχει λήξει. Παρακαλώ συνδεθείτε ξανά.")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Αποτυχία επαλήθευσης Token: {str(e)}")
    