# Planos de ejemplo — Casa Las Lilas (primer piso)

Vivienda de un piso de 14 × 10 m: living-comedor, cocina, logia, pasillo, baño y
tres dormitorios. Son 5 láminas DXF (AutoCAD R2000, milímetros), una por
especialidad y todas en el mismo sistema de coordenadas, como las exporta un
proyecto real:

| Archivo | Capas CAD | Se importan como |
|---|---|---|
| `01-arquitectura-primer-piso.dxf` | `A-MUROS`, `EST-PILARES` (+ textos, puertas, cotas y deslinde) | Muros y pilares (el resto no se importa) |
| `02-alcantarillado-primer-piso.dxf` | `ALC-COLECTOR`, `ALC-CAMARAS`, `ALC-UD` | Colector PVC Ø110, descargas Ø75, cámaras C.I. 1–3 y unión domiciliaria Ø160 |
| `03-agua-potable-primer-piso.dxf` | `AP-RED` | Matriz AP PPR Ø25 y arranque Ø20 a la logia |
| `04-electrico-primer-piso.dxf` | `ELEC-ALIMENTADORES`, `ELEC-TABLEROS` | Acometida, circuito de dormitorios y tablero TDA |
| `05-gas-primer-piso.dxf` | `GAS-RED`, `GAS-MEDIDOR` | Red de gas Cu 1/2", calefón y medidor |

## Cómo probarlo

1. Entra a una obra en `/obra/<id>/planos` y pulsa **Subir capa**.
2. Sube los archivos en orden, empezando por arquitectura, con el mismo nivel
   (p. ej. `0`, «Primer piso»). La app propone el tipo de cada capa CAD y el
   ancho real según las unidades del dibujo.
3. Las láminas siguientes se alinean solas con la primera, porque comparten el
   origen CAD.
4. Con **Reportar hallazgo**, toca el pasillo (entre el muro sur y el colector) y
   reporta, por ejemplo, «Humedad y grieta en muro del pasillo». El panel muestra
   el agua potable a ~0,1 m, el colector a ~0,5 m y el circuito eléctrico a ~0,9 m,
   y deja sugerencias pendientes de aprobación.
