import React from 'react';
import styled from 'styled-components/native';

const Screen = styled.View`
  flex: 1;
  background-color: #000;
  align-items: center;
  justify-content: center;
`;

const Label = styled.Text`
  color: #fff;
  font-size: 18px;
`;

export default function DownloadsScreen() {
  return (
    <Screen>
      <Label>Downloads</Label>
    </Screen>
  );
}