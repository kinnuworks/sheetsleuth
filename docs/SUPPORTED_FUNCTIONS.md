# Supported Functions

The evaluator supports only the functions below. Function names are case-insensitive.

| Group | Functions |
|---|---|
| Aggregation | `SUM`, `AVERAGE`, `COUNT`, `COUNTA`, `MIN`, `MAX` |
| Math | `ROUND`, `ABS` |
| Logic | `IF`, `IFERROR`, `AND`, `OR`, `NOT` |
| Conditional | `SUMIF`, `COUNTIF` |
| Lookup | `VLOOKUP`, `HLOOKUP`, `INDEX`, `MATCH` |
| Text | `LEFT`, `RIGHT`, `LEN`, `CONCATENATE` |
| Date | `DATE`, `YEAR`, `MONTH`, `DAY` |
| Finance | `PMT` |

Unknown functions, array constants, spill references, structured references, external links,
and unsupported operators evaluate to `Unverified(reason)`. `Unverified` values spread to
dependent expressions rather than being presented as numbers.
