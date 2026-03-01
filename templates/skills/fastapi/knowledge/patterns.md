# fastapi — Successful Patterns

Best practices for working with fastapi.

---

## Dependency Injection

**Context**: Shared logic across endpoints

**Example**:
```
async def get_current_user(token: str = Depends(oauth2_scheme)):
    user = await verify_token(token)
    if not user:
        raise HTTPException(status_code=401)
    return user

@router.get("/me")
async def read_me(user: User = Depends(get_current_user)):
    return user
```

**Why it works**: Dependencies are composable, testable, and automatically resolved by FastAPI

---

## Pydantic Response Models

**Context**: Type-safe API responses

**Example**:
```
class UserResponse(BaseModel):
    id: int
    name: str
    model_config = ConfigDict(from_attributes=True)

@router.get("/users/{id}", response_model=UserResponse)
async def get_user(id: int):
    return await db.get_user(id)
```

**Why it works**: response_model auto-serializes, validates, and documents the response schema

---

