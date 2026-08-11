# Home Assistant integration

This directory is reserved for the AutiPlanner custom integration.

Do not advertise it as installable until the minimum integration skeleton, config flow, tests, and safe persistence behavior exist.

## Intended layout

```text
integrations/home-assistant/
  custom_components/
    autiplanner/
      __init__.py
      manifest.json
      config_flow.py
      const.py
      calendar.py
      todo.py
      services.yaml
      storage.py
      ...
  tests/
```

## Responsibilities

- own/read/write the configured `.ics` source;
- expose standards-compatible Home Assistant entities;
- preserve AutiPlanner day part and four-state outcome;
- expose mutations for complete/missed/skipped/reset;
- serialize mutations;
- persist with atomic replacement;
- avoid logging sensitive routine descriptions by default.

Before implementing this integration, verify behavior against current official Home Assistant developer documentation and add tests using current Home Assistant custom-component testing patterns.
