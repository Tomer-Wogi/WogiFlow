# typeorm — Successful Patterns

Best practices for working with typeorm.

---

## Entity with Relations

**Context**: Defining database entities

**Example**:
```
@Entity()
export class User {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @OneToMany(() => Post, (post) => post.author)
  posts: Post[];
}
```

**Why it works**: Decorator-based entities provide clear mapping between TS classes and DB tables

---

