# pytest — Conventions

Naming and structural conventions for pytest.

---

- Test files: test_*.py or *_test.py
- Fixtures in conftest.py for shared fixtures
- Use @pytest.mark.parametrize for data-driven tests
- Use monkeypatch for mocking (over unittest.mock when possible)
- Group tests in classes when they share setup

---

_Customize these conventions based on your team's preferences._
