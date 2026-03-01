# flask — Successful Patterns

Best practices for working with flask.

---

## Application Factory

**Context**: Creating Flask app instances

**Example**:
```
def create_app(config="config.py"):
    app = Flask(__name__)
    app.config.from_pyfile(config)
    db.init_app(app)
    app.register_blueprint(api_bp, url_prefix="/api")
    return app
```

**Why it works**: Factory pattern enables testing with different configs and avoids circular imports

---

## Blueprints for Modularity

**Context**: Organizing routes by feature

**Example**:
```
api_bp = Blueprint("api", __name__)

@api_bp.route("/users")
def list_users():
    return jsonify(User.query.all())
```

**Why it works**: Blueprints allow splitting a large app into maintainable modules

---

