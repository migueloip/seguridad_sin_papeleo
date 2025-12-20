export const documentTypes = [
  { id: 1, name: "Cedula de Identidad", validity_days: 3650 },
  { id: 2, name: "Licencia de Conducir", validity_days: 1825 },
  { id: 3, name: "Certificado de Antecedentes", validity_days: 90 },
  { id: 4, name: "Examen Preocupacional", validity_days: 365 },
  { id: 5, name: "Curso Altura Fisica", validity_days: 365 },
  { id: 6, name: "Curso Trabajo en Altura", validity_days: 730 },
  { id: 7, name: "Curso ODI", validity_days: 365 },
  { id: 8, name: "Curso RIHS", validity_days: 365 },
  { id: 9, name: "Certificado AFP", validity_days: 30 },
  { id: 10, name: "Certificado Salud", validity_days: 30 },
  { id: 11, name: "Contrato de Trabajo", validity_days: null },
  { id: 12, name: "Anexo de Contrato", validity_days: null },
  { id: 13, name: "Certificado de Competencias", validity_days: 730 },
  { id: 14, name: "Carnet de Operador", validity_days: 730 },
  { id: 15, name: "Habilitacion Vehicular", validity_days: 365 },
  { id: 16, name: "Informe", validity_days: null },
]

export type DocumentType = (typeof documentTypes)[number]
