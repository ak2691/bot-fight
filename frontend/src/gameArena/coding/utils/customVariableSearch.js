export function filterCustomVariableEntries(variables, query) {
    const normalizedQuery = String(query ?? "").trim().toLocaleLowerCase();
    return variables
        .map((variable, index) => ({ variable, index }))
        .filter(({ variable }) => !normalizedQuery || String(variable?.name ?? "").toLocaleLowerCase().includes(normalizedQuery));
}
