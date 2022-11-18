import { useState, useEffect } from 'react';
import { describePackage, PackageDescription } from '@openfn/describe-package';

const useDocs = (specifier: string) => {
  // null if loading, false  if failed
  const [docs, setDocs] = useState<PackageDescription | null | false>(null);

  useEffect(() => {
    describePackage(specifier, {}).then((result) => {
      setDocs(result);
    });
  }, [specifier])

  return docs;
};

export default useDocs;