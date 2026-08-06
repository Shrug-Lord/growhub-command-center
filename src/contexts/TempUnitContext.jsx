import React, { createContext, useContext, useState } from 'react'

export { fromDisplayTemp, toDisplayTemp } from '../utils/temperature.js'

const TempUnitContext = createContext(null)

export function TempUnitProvider({ children }) {
  const [unit, setUnit] = useState(() => localStorage.getItem('temp_unit') ?? 'C')
  function changeUnit(u) {
    localStorage.setItem('temp_unit', u)
    setUnit(u)
  }
  return (
    <TempUnitContext.Provider value={{ unit, changeUnit }}>{children}</TempUnitContext.Provider>
  )
}

export function useTempUnit() {
  return useContext(TempUnitContext)
}
