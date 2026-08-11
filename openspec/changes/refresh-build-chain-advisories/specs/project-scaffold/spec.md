## ADDED Requirements

### Requirement: High-severity dependency advisories are not buried

The repository SHALL keep high-severity dependency advisories visible and
actionable. When a compatible patched version exists, the dependency lock SHALL
resolve to that fixed version. When no compatible fix exists, the repository
SHALL record whether the affected package is runtime-reachable, why temporary
acceptance is safe, and the concrete trigger for revisiting it.

A previously accepted advisory SHALL NOT remain documented as unavoidable after
a compatible fix becomes available.

#### Scenario: A compatible patch is available

- **WHEN** the dependency audit reports a high-severity advisory and the existing
  parent ranges admit a patched transitive version
- **THEN** the committed lockfile resolves the dependency to the patched version
- **AND** a clean install, audit, tests, and production build pass

#### Scenario: No compatible patch exists

- **WHEN** a high-severity advisory has no compatible fixed resolution
- **THEN** the repository records its dependency path, runtime reachability,
  temporary safety rationale, and trigger to review it again

#### Scenario: An accepted warning later becomes fixable

- **WHEN** a compatible fixed version becomes available for a previously tracked
  advisory
- **THEN** the accepted exception is removed and the patched dependency is
  verified without widening the change into unrelated upgrades
