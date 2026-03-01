# nestjs — Successful Patterns

Best practices for working with nestjs.

---

## Module-Scoped Architecture

**Context**: Organizing features into self-contained modules

**Example**:
```
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
```

**Why it works**: Each module encapsulates a feature with its own controllers, services, and entities

---

## DTO Validation with class-validator

**Context**: Validating incoming request data

**Example**:
```
export class CreateUserDto {
  @IsString() @MinLength(2) name: string;
  @IsEmail() email: string;
}

// Controller
@Post()
create(@Body() dto: CreateUserDto) { ... }
```

**Why it works**: Validation pipes automatically reject invalid requests before they reach service logic

---

