import React from "react";
import styled from "styled-components/native";
import { Button, TextInput } from "react-native";
import { getStreamData } from "../core/api";

const Screen = styled.View`
  flex: 1;
  background-color: #000;
  padding: 32px 16px;
`;

const Label = styled.Text`
  color: #fff;
  font-size: 18px;
  margin-bottom: 12px;
`;

const Input = styled.TextInput`
  background-color: #fff;
  border-radius: 8px;
  padding: 8px 12px;
`;

const Text = styled.Text`
  color: #fff;
`;

const ErrorText = styled.Text`
  color: #f87171;
`;

export default function PlayerScreen() {
  const [id, setId] = React.useState("SeGNxgujehE");
  const [title, setTitle] = React.useState("");
  const [error, setError] = React.useState("");

  async function load() {
    setError("");
    try {
      const data = await getStreamData(id, "piped");
      setTitle(data.title);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    }
  }

  return (
    <Screen>
      <Label>Player</Label>
      <Input value={id} onChangeText={setId} placeholder="Video ID" />
      <Button title="Load" onPress={load} />
      {!!title && <Text>Title: {title}</Text>}
      {!!error && <ErrorText>{error}</ErrorText>}
    </Screen>
  );
}
