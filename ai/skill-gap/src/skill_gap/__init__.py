"""The skill-gap service.

A package rather than loose modules on the path: two services both exporting a top-level
`compute` collide in pytest AND in an environment where both wheels are installed, which is
a packaging bug rather than a test artifact.
"""
