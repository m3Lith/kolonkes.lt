import { FUEL_LABELS_LT, type StationRecord } from "../lib/types";

interface StationPopupProps {
  station: StationRecord;
  date: string;
}

export function StationPopup({ station, date }: StationPopupProps) {
  return (
    <div className="popup">
      <strong>{station.company}</strong>
      <div>{station.region}</div>
      <div>{station.address}</div>
      <div className="date">Data: {date}</div>
      <table>
        <tbody>
          {station.fuelPrices.map((fuel) => (
            <tr key={fuel.fuelType}>
              <td>{FUEL_LABELS_LT[fuel.fuelType]}</td>
              <td>{fuel.pricePerLiter === null ? "-" : `${fuel.pricePerLiter.toFixed(3)} EUR`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
