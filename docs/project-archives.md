# Project Archives

CBCTer project exports use `.cbcter.zip` packages.

The archive contains:

- `study.json`: versioned manifest, study state, and embedded data provenance.
- `masks/*.bin`: binary mask buffers.
- `surfaces/*.stl`: generated or restored surface meshes.

Current manifest version: `2`.

Version `1` packages are migrated on import. Paths inside the archive are
validated and normalized before mask or surface data is restored.

Project packages are intended for CBCTer state exchange. VolView session import
is a separate interoperability feature because VolView stores a different data
source graph, view layout model, tool state model, and segmentation format.
